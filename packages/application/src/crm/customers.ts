import { DomainError } from '@restroos/domain';
import type { Patch } from '../patch';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';

export interface CustomerRecord {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  taxId: string | null;
  preferredLocale: 'en-IN' | 'hi-IN' | 'bn-IN' | null;
  visitCount: number;
  lifetimeValue: number;
  lastVisitAt: string | null;
  marketingOptIn: boolean;
  version: number;
}

export interface CustomerRepository {
  get(id: string): CustomerRecord | undefined;
  byPhone(phone: string): CustomerRecord | undefined;
  /** By phone digits or name, most recent visitors first. */
  search(query: string, limit: number): CustomerRecord[];
  insert(record: CustomerRecord, actorId: string | null, at: Date): void;
  /** Version-checked. */
  update(record: CustomerRecord, actorId: string | null, at: Date): void;
  /** Visit bookkeeping (no version bump): one visit per paid order, its value added to lifetime spend. */
  recordVisit(id: string, amount: number, at: Date): void;
  /** Refunds reduce lifetime spend. */
  addLifetimeValue(id: string, amount: number): void;
  recentInvoices(
    id: string,
    limit: number,
  ): { id: string; invoiceNo: string; businessDate: string; grandTotal: number; status: string }[];
  favourites(id: string, limit: number): { name: string; quantity: number }[];
}

type CustomerInput = Omit<
  CustomerRecord,
  'id' | 'visitCount' | 'lifetimeValue' | 'lastVisitAt' | 'version'
>;

/** Guests by mobile number: who they are, how often they come, what they spend (docs/09 WP 5.6). */
export class CustomerService {
  constructor(
    private readonly d: {
      customers: CustomerRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  search(query: string): CustomerRecord[] {
    return this.d.customers.search(query.trim(), 20);
  }

  detail(id: string) {
    const customer = this.d.customers.get(id);
    if (!customer) throw new DomainError('NOT_FOUND', 'customer not found');
    return {
      ...customer,
      recentInvoices: this.d.customers.recentInvoices(id, 10),
      favourites: this.d.customers.favourites(id, 5),
    };
  }

  create(input: CustomerInput, ctx: CommandContext): CustomerRecord {
    return this.d.unitOfWork.run(ctx, (scope) => this.createIn(scope, input, ctx));
  }

  update(
    id: string,
    patch: Patch<CustomerInput> & { version: number },
    ctx: CommandContext,
  ): CustomerRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.customers.get(id);
      if (!current) throw new DomainError('NOT_FOUND', 'customer not found');
      if (current.version !== patch.version)
        throw new DomainError('VERSION_CONFLICT', 'this customer changed; reload');
      const next: CustomerRecord = { ...current, version: current.version + 1 };
      for (const [k, v] of Object.entries(patch))
        if (v !== undefined && k !== 'version') (next as unknown as Record<string, unknown>)[k] = v;
      if (next.phone !== current.phone && this.d.customers.byPhone(next.phone)) {
        throw new DomainError('PHONE_TAKEN', 'another customer has this number');
      }
      const now = this.d.clock.now();
      this.d.customers.update(next, ctx.actorId, now);
      scope.recordEvents([
        recordChanged('CustomerChanged', 'Customer', id, next.version, { name: next.name }, now),
      ]);
      scope.audit({
        action: 'crm.customer.update',
        entityType: 'Customer',
        entityId: id,
        before: current,
        after: next,
      });
      return next;
    });
  }

  /** At billing, inside the bill's transaction: the guest by phone, added if new, name and GSTIN filled in if missing. */
  findOrCreateIn(
    scope: TransactionScope,
    input: { phone: string; name?: string | undefined; taxId?: string | undefined },
    ctx: CommandContext,
  ): CustomerRecord {
    const existing = this.d.customers.byPhone(input.phone);
    if (!existing) {
      return this.createIn(
        scope,
        {
          phone: input.phone,
          name: input.name ?? null,
          email: null,
          taxId: input.taxId ?? null,
          preferredLocale: null,
          marketingOptIn: false,
        },
        ctx,
      );
    }
    const fill = {
      name: existing.name ?? input.name ?? null,
      taxId: existing.taxId ?? input.taxId ?? null,
    };
    if (fill.name === existing.name && fill.taxId === existing.taxId) return existing;
    const next = { ...existing, ...fill, version: existing.version + 1 };
    this.d.customers.update(next, ctx.actorId, this.d.clock.now());
    scope.audit({
      action: 'crm.customer.update',
      entityType: 'Customer',
      entityId: existing.id,
      before: existing,
      after: next,
    });
    return next;
  }

  private createIn(
    scope: TransactionScope,
    input: CustomerInput,
    ctx: CommandContext,
  ): CustomerRecord {
    if (this.d.customers.byPhone(input.phone))
      throw new DomainError('PHONE_TAKEN', 'a customer with this number exists');
    const now = this.d.clock.now();
    const record: CustomerRecord = {
      ...input,
      id: this.d.ids.next(),
      visitCount: 0,
      lifetimeValue: 0,
      lastVisitAt: null,
      version: 1,
    };
    this.d.customers.insert(record, ctx.actorId, now);
    // The phone number is personal data: events (synced to the cloud) carry only the id.
    scope.recordEvents([
      recordChanged('CustomerCreated', 'Customer', record.id, 1, { name: record.name }, now),
    ]);
    scope.audit({
      action: 'crm.customer.create',
      entityType: 'Customer',
      entityId: record.id,
      after: { name: record.name },
    });
    return record;
  }
}
