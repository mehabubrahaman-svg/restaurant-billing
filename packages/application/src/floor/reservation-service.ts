import { DomainError } from '@restroos/domain';
import type { CustomerService } from '../crm/customers';
import type { Patch } from '../patch';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';
import type { FloorRepository } from './ports';

export type ReservationStatus = 'BOOKED' | 'SEATED' | 'CANCELLED' | 'NO_SHOW';

export interface ReservationRecord {
  id: string;
  tableId: string | null;
  tableLabel: string | null;
  customerId: string | null;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  /** ISO 8601 instant. */
  reservedFor: string;
  status: ReservationStatus;
  notes: string | null;
  createdAt: string;
  version: number;
}

export interface ReservationRepository {
  get(branchId: string, id: string): ReservationRecord | undefined;
  /** Every status, by time; `from` and `to` are ISO instants. */
  between(branchId: string, from: string, to: string): ReservationRecord[];
  /** BOOKED reservations on the table that start inside the window (to find clashes). */
  bookedOnTable(branchId: string, tableId: string, from: string, to: string): ReservationRecord[];
  insert(branchId: string, record: ReservationRecord, actorId: string | null, at: Date): void;
  /** Version-checked. */
  update(branchId: string, record: ReservationRecord, at: Date): void;
}

type ReservationInput = Pick<
  ReservationRecord,
  'guestName' | 'guestPhone' | 'partySize' | 'reservedFor' | 'tableId' | 'notes'
>;

/** A booking holds its table for this long either side of its time. */
export const TABLE_HOLD_MINUTES = 120;
/** A booking can be entered this late (a guest who phoned just before walking in). */
const PAST_GRACE_MINUTES = 30;

const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Table bookings (wireframes §4: reserved tables on the captain's floor). */
export class ReservationService {
  constructor(
    private readonly d: {
      reservations: ReservationRepository;
      floor: FloorRepository;
      customerService: CustomerService;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  list(branchId: string, from: string, to: string): ReservationRecord[] {
    return this.d.reservations.between(branchId, from, to);
  }

  /** The next booking per table, from 30 minutes ago to 12 hours ahead, for the floor tiles. */
  nextByTable(branchId: string): Map<string, ReservationRecord> {
    const now = this.d.clock.now().getTime();
    const next = new Map<string, ReservationRecord>();
    for (const r of this.d.reservations.between(
      branchId,
      iso(now - PAST_GRACE_MINUTES * MINUTE),
      iso(now + 12 * 60 * MINUTE),
    )) {
      if (r.status === 'BOOKED' && r.tableId !== null && !next.has(r.tableId))
        next.set(r.tableId, r);
    }
    return next;
  }

  create(input: ReservationInput, ctx: CommandContext): ReservationRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const reservedFor = this.checkTime(input.reservedFor, now);
      const tableLabel = this.checkTable(ctx.branchId, input.tableId, reservedFor, null);
      const customerId =
        input.guestPhone === null
          ? null
          : this.d.customerService.findOrCreateIn(
              scope,
              { phone: input.guestPhone, name: input.guestName },
              ctx,
            ).id;
      const record: ReservationRecord = {
        ...input,
        reservedFor,
        tableLabel,
        customerId,
        id: this.d.ids.next(),
        status: 'BOOKED',
        createdAt: now.toISOString(),
        version: 1,
      };
      this.d.reservations.insert(ctx.branchId, record, ctx.actorId, now);
      scope.recordEvents([this.event('ReservationBooked', record, now)]);
      scope.audit({
        action: 'floor.reservation.create',
        entityType: 'Reservation',
        entityId: record.id,
        after: { ...record, guestPhone: undefined },
      });
      return record;
    });
  }

  update(
    id: string,
    patch: Patch<ReservationInput> & { version: number },
    ctx: CommandContext,
  ): ReservationRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.booked(ctx.branchId, id, patch.version);
      const now = this.d.clock.now();
      const next: ReservationRecord = { ...current, version: current.version + 1 };
      for (const [k, v] of Object.entries(patch))
        if (v !== undefined && k !== 'version') (next as unknown as Record<string, unknown>)[k] = v;
      if (next.reservedFor !== current.reservedFor)
        next.reservedFor = this.checkTime(next.reservedFor, now);
      next.tableLabel = this.checkTable(ctx.branchId, next.tableId, next.reservedFor, id);
      if (next.guestPhone !== current.guestPhone) {
        next.customerId =
          next.guestPhone === null
            ? null
            : this.d.customerService.findOrCreateIn(
                scope,
                { phone: next.guestPhone, name: next.guestName },
                ctx,
              ).id;
      }
      this.d.reservations.update(ctx.branchId, next, now);
      scope.recordEvents([this.event('ReservationChanged', next, now)]);
      scope.audit({
        action: 'floor.reservation.update',
        entityType: 'Reservation',
        entityId: id,
        before: { ...current, guestPhone: undefined },
        after: { ...next, guestPhone: undefined },
      });
      return next;
    });
  }

  /** The guests arrived (the captain then opens their table), cancelled, or didn't come. */
  close(
    id: string,
    status: Exclude<ReservationStatus, 'BOOKED'>,
    version: number,
    ctx: CommandContext,
  ): ReservationRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.booked(ctx.branchId, id, version);
      const now = this.d.clock.now();
      const next: ReservationRecord = { ...current, status, version: current.version + 1 };
      this.d.reservations.update(ctx.branchId, next, now);
      const type = {
        SEATED: 'ReservationSeated',
        CANCELLED: 'ReservationCancelled',
        NO_SHOW: 'ReservationNoShow',
      }[status];
      scope.recordEvents([this.event(type, next, now)]);
      scope.audit({
        action: `floor.reservation.${status.toLowerCase()}`,
        entityType: 'Reservation',
        entityId: id,
        before: { status: current.status },
        after: { status },
      });
      return next;
    });
  }

  private booked(branchId: string, id: string, version: number): ReservationRecord {
    const current = this.d.reservations.get(branchId, id);
    if (!current) throw new DomainError('NOT_FOUND', 'reservation not found');
    if (current.version !== version)
      throw new DomainError('VERSION_CONFLICT', 'this reservation changed; reload');
    if (current.status !== 'BOOKED') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `this reservation is already ${current.status.toLowerCase().replace('_', '-')}`,
      );
    }
    return current;
  }

  /** Normalised to UTC; not more than 30 minutes in the past. */
  private checkTime(reservedFor: string, now: Date): string {
    const at = new Date(reservedFor).getTime();
    if (at < now.getTime() - PAST_GRACE_MINUTES * MINUTE) {
      throw new DomainError('VALIDATION_FAILED', 'that time has already passed');
    }
    return iso(at);
  }

  /** The table's label; refused when another booking holds it within 2 hours. */
  private checkTable(
    branchId: string,
    tableId: string | null,
    reservedFor: string,
    self: string | null,
  ): string | null {
    if (tableId === null) return null;
    const table = this.d.floor.table(branchId, tableId);
    if (!table || !table.isActive) throw new DomainError('NOT_FOUND', 'table not found');
    const at = new Date(reservedFor).getTime();
    const clash = this.d.reservations
      .bookedOnTable(
        branchId,
        tableId,
        iso(at - TABLE_HOLD_MINUTES * MINUTE + 1),
        iso(at + TABLE_HOLD_MINUTES * MINUTE - 1),
      )
      .find((r) => r.id !== self);
    if (clash) {
      throw new DomainError(
        'TABLE_ALREADY_RESERVED',
        `${table.label} is booked for ${clash.guestName} at ${clash.reservedFor}`,
      );
    }
    return table.label;
  }

  // The guest's phone number is personal data: events (synced to the cloud) leave it out.
  private event(type: string, r: ReservationRecord, at: Date) {
    return recordChanged(
      type,
      'Reservation',
      r.id,
      r.version,
      { tableId: r.tableId, status: r.status, reservedFor: r.reservedFor, partySize: r.partySize },
      at,
    );
  }
}
