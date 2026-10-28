import { DomainError, type PaymentMethod } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';
import type { ShiftRecord, ShiftRepository, TenderCount } from './ports';

/**
 * Cash shifts at a counter (docs/01 §5.9, docs/09 WP 5.3). Cash needs an open
 * shift; at close the cashier counts the drawer and enters each card/UPI
 * terminal's batch total, and the Z report shows the differences.
 */
export class ShiftService {
  constructor(
    private readonly d: {
      shifts: ShiftRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  current(ctx: CommandContext): ShiftRecord | undefined {
    return this.d.shifts.openFor(ctx.branchId, ctx.deviceId ?? null, ctx.actorId!);
  }

  open(openingFloat: number, ctx: CommandContext): ShiftRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      if (this.current(ctx))
        throw new DomainError('SHIFT_ALREADY_OPEN', 'a shift is already open on this counter');
      const now = this.d.clock.now();
      const shift: ShiftRecord = {
        id: this.d.ids.next(),
        branchId: ctx.branchId,
        deviceId: ctx.deviceId ?? null,
        openedBy: ctx.actorId!,
        openedAt: now,
        openingFloat,
        status: 'OPEN',
        version: 1,
      };
      this.d.shifts.insert(shift);
      scope.recordEvents([
        recordChanged('ShiftOpened', 'CashShift', shift.id, 1, { openingFloat }, now),
      ]);
      scope.audit({
        action: 'cash.shift.open',
        entityType: 'CashShift',
        entityId: shift.id,
        after: { openingFloat },
      });
      return shift;
    });
  }

  close(
    id: string,
    input: {
      version: number;
      countedCash: number;
      denominations?: Record<string, number> | undefined;
      tenders: readonly { method: PaymentMethod; terminalLabel: string; reportedAmount: number }[];
      notes?: string | undefined;
    },
    ctx: CommandContext,
  ): void {
    this.d.unitOfWork.run(ctx, (scope) => {
      const shift = this.d.shifts.get(ctx.branchId, id);
      if (!shift) throw new DomainError('NOT_FOUND', 'shift not found');
      if (shift.status !== 'OPEN')
        throw new DomainError('INVALID_STATE_TRANSITION', 'this shift is already closed');
      if (shift.version !== input.version) {
        throw new DomainError('VERSION_CONFLICT', 'this shift changed; reload and try again');
      }
      if (input.denominations) {
        const counted = Object.entries(input.denominations).reduce(
          (s, [note, n]) => s + Number(note) * 100 * n,
          0,
        );
        if (counted !== input.countedCash) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'the notes and coins don’t add up to the counted cash',
          );
        }
      }
      const totals = this.d.shifts.tenderTotals(id);
      const expectedCash =
        shift.openingFloat +
        totals.filter((t) => t.method === 'CASH').reduce((s, t) => s + t.amount, 0);
      const keys = new Map<string, TenderCount>();
      for (const t of totals) {
        if (t.method === 'CASH') continue;
        keys.set(`${t.method}|${t.terminalLabel}`, {
          method: t.method,
          terminalLabel: t.terminalLabel,
          expected: t.amount,
          reported: 0,
        });
      }
      for (const r of input.tenders) {
        if (r.method === 'CASH') continue;
        const key = `${r.method}|${r.terminalLabel}`;
        const row = keys.get(key) ?? {
          method: r.method,
          terminalLabel: r.terminalLabel,
          expected: 0,
          reported: 0,
        };
        keys.set(key, { ...row, reported: r.reportedAmount });
      }
      // Tenders nobody reported count as reported = expected only for credit and aggregator (no settlement slip).
      const tenders = [...keys.values()].map((t) =>
        (t.method === 'CREDIT' || t.method === 'AGGREGATOR') &&
        !input.tenders.some((r) => r.method === t.method)
          ? { ...t, reported: t.expected }
          : t,
      );
      const now = this.d.clock.now();
      this.d.shifts.close(id, input.version, {
        closedBy: ctx.actorId!,
        closedAt: now,
        expectedCash,
        countedCash: input.countedCash,
        denominations: input.denominations ?? null,
        notes: input.notes ?? null,
        tenders: [
          {
            method: 'CASH',
            terminalLabel: '',
            expected: expectedCash,
            reported: input.countedCash,
          },
          ...tenders,
        ],
      });
      const variance = input.countedCash - expectedCash;
      scope.recordEvents([
        recordChanged(
          'ShiftClosed',
          'CashShift',
          id,
          shift.version + 1,
          { expectedCash, countedCash: input.countedCash, variance },
          now,
        ),
      ]);
      scope.audit({
        action: 'cash.shift.close',
        entityType: 'CashShift',
        entityId: id,
        after: { expectedCash, countedCash: input.countedCash, variance, tenders },
        reason: input.notes ?? null,
      });
    });
  }
}
