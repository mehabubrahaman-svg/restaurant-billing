import {
  boostedPoints,
  DomainError,
  pointsEarned,
  pointsToRedeem,
  type LoyaltyProgram,
} from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import type { SettingsRepository } from '../settings/ports';
import { recordChanged } from '../shared-events';
import type { CustomerRepository } from './customers';
import { guestTier, type MembershipTierRepository } from './membership';

export type LoyaltyKind = 'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST';

export interface LoyaltyEntryRecord {
  id: string;
  customerId: string;
  branchId: string;
  invoiceId: string | null;
  kind: LoyaltyKind;
  /** Signed. */
  points: number;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface LoyaltyRepository {
  /** Appends the entry and moves customers.loyalty_points by its points, in the caller's transaction. */
  insert(entry: LoyaltyEntryRecord): void;
  /** Newest first, with the invoice number and who made the entry. */
  entries(
    customerId: string,
    limit: number,
  ): (LoyaltyEntryRecord & { invoiceNo: string | null; createdByName: string | null })[];
  /** Net points of each kind booked against these invoices (to undo them). */
  netByKind(
    invoiceIds: readonly string[],
  ): { customerId: string; kind: LoyaltyKind; points: number }[];
}

/**
 * Loyalty points (docs/08 Phase 5): earned on what a guest pays, spent as the
 * LOYALTY tender, adjusted by a manager. The ledger is append-only; reversals
 * are new entries.
 */
export class LoyaltyService {
  constructor(
    private readonly d: {
      loyalty: LoyaltyRepository;
      customers: CustomerRepository;
      tiers: MembershipTierRepository;
      settings: SettingsRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  program(branchId: string): LoyaltyProgram {
    const b = this.d.settings.branch(branchId);
    return {
      enabled: b?.loyaltyEnabled ?? false,
      earnPer100: b?.loyaltyEarnPer100 ?? 0,
      pointValue: b?.loyaltyPointValue ?? 100,
      minRedeem: b?.loyaltyMinRedeem ?? 1,
    };
  }

  ledger(customerId: string, branchId: string) {
    const customer = this.d.customers.get(customerId);
    if (!customer) throw new DomainError('NOT_FOUND', 'customer not found');
    return {
      balance: customer.loyaltyPoints,
      entries: this.d.loyalty.entries(customerId, 100),
      program: this.program(branchId),
    };
  }

  /** A manager adds or takes away points; the balance can't go below zero. */
  adjust(customerId: string, points: number, note: string, ctx: CommandContext) {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const customer = this.d.customers.get(customerId);
      if (!customer) throw new DomainError('NOT_FOUND', 'customer not found');
      if (customer.loyaltyPoints + points < 0) {
        throw new DomainError(
          'LOYALTY_INSUFFICIENT',
          `the guest has ${customer.loyaltyPoints} points`,
        );
      }
      this.add(scope, ctx, { customerId, invoiceId: null, kind: 'ADJUST', points, note });
      scope.audit({
        action: 'crm.loyalty.adjust',
        entityType: 'Customer',
        entityId: customerId,
        before: { loyaltyPoints: customer.loyaltyPoints },
        after: { loyaltyPoints: customer.loyaltyPoints + points },
        reason: note,
      });
      return this.ledger(customerId, ctx.branchId);
    });
  }

  /** Inside the payment's transaction: spends the points a LOYALTY payment of `amount` uses. */
  redeemIn(
    scope: TransactionScope,
    ctx: CommandContext,
    input: { customerId: string | null; invoiceId: string; amount: number },
  ): void {
    if (input.customerId === null) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'put the guest’s mobile number on the bill to pay with points',
      );
    }
    const customer = this.d.customers.get(input.customerId);
    if (!customer) throw new DomainError('NOT_FOUND', 'customer not found');
    const points = pointsToRedeem(input.amount, customer.loyaltyPoints, this.program(ctx.branchId));
    this.add(scope, ctx, {
      customerId: customer.id,
      invoiceId: input.invoiceId,
      kind: 'REDEEM',
      points: -points,
      note: null,
    });
  }

  /**
   * Inside the payment's transaction, once the order is paid (and its visit
   * counted): points on what the guest paid, times their tier's multiplier.
   */
  earnIn(
    scope: TransactionScope,
    ctx: CommandContext,
    input: { customerId: string; invoiceId: string; paid: number },
  ): void {
    const customer = this.d.customers.get(input.customerId);
    const tier = customer ? guestTier(this.d.tiers.all(), customer) : null;
    const base = pointsEarned(input.paid, this.program(ctx.branchId));
    const points = boostedPoints(base, tier);
    if (points === 0) return;
    this.add(scope, ctx, {
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      kind: 'EARN',
      points,
      note: null,
    });
  }

  /**
   * Inside a cancellation's transaction: gives back the points spent on these
   * invoices and takes back what they earned (the balance may go below zero
   * if the guest already spent them).
   */
  reverseIn(scope: TransactionScope, ctx: CommandContext, invoiceIds: readonly string[]): void {
    for (const row of this.d.loyalty.netByKind(invoiceIds)) {
      if (row.points === 0 || (row.kind !== 'EARN' && row.kind !== 'REDEEM')) continue;
      this.add(scope, ctx, {
        customerId: row.customerId,
        invoiceId: invoiceIds[0] ?? null,
        kind: row.kind,
        points: -row.points,
        note: 'bill cancelled',
      });
    }
  }

  private add(
    scope: TransactionScope,
    ctx: CommandContext,
    e: Pick<LoyaltyEntryRecord, 'customerId' | 'invoiceId' | 'kind' | 'points' | 'note'>,
  ): void {
    const now = this.d.clock.now();
    const entry: LoyaltyEntryRecord = {
      ...e,
      id: this.d.ids.next(),
      branchId: ctx.branchId,
      createdAt: now.toISOString(),
      createdBy: ctx.actorId,
    };
    this.d.loyalty.insert(entry);
    // Each entry is its own immutable record. Personal data stays out of events.
    scope.recordEvents([
      recordChanged(
        'LoyaltyPointsChanged',
        'LoyaltyEntry',
        entry.id,
        1,
        { customerId: e.customerId, kind: e.kind, points: e.points, invoiceId: e.invoiceId },
        now,
      ),
    ]);
  }
}
