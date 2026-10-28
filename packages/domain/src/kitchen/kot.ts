import { AggregateRoot } from '../shared/aggregate-root';
import { DomainError } from '../shared/result';
import type { OrderItemStatus } from '../ordering/order';

export type KotStatus = 'NEW' | 'ACCEPTED' | 'COOKING' | 'READY' | 'SERVED' | 'CANCELLED';

const FLOW: readonly KotStatus[] = ['NEW', 'ACCEPTED', 'COOKING', 'READY', 'SERVED'];
/** Default when no item on the KOT has a prep time. */
export const DEFAULT_PREP_SEC = 15 * 60;

export interface KotLine {
  readonly id: string;
  status: OrderItemStatus;
  readyAt: Date | null;
}

export interface KotState {
  branchId: string;
  orderId: string;
  kitchenStationId: string | null;
  kotNo: number;
  businessDate: string;
  status: KotStatus;
  priority: number;
  assignedChefId: string | null;
  firedAt: Date;
  acceptedAt: Date | null;
  cookingAt: Date | null;
  readyAt: Date | null;
  servedAt: Date | null;
  targetReadyAt: Date;
  createdBy: string;
  lines: KotLine[];
}

/** What a KOT change did to its items, for the repository to write back to order_items. */
export interface KotLineChange {
  readonly id: string;
  readonly status: OrderItemStatus;
  readonly readyAt: Date | null;
}

/**
 * A kitchen order ticket: one batch of items for one station (docs/03 §4.1).
 * Status only moves forward, NEW → ACCEPTED → COOKING → READY → SERVED; steps
 * may be skipped (a fast station taps READY straight away). Item statuses
 * follow the ticket, and bumping the last item makes the ticket READY.
 */
export class Kot extends AggregateRoot {
  readonly aggregateType = 'Kot';
  private changes = new Map<string, KotLineChange>();

  private constructor(
    id: string,
    version: number,
    private readonly s: KotState,
  ) {
    super(id, version);
  }

  static restore(id: string, version: number, state: KotState): Kot {
    return new Kot(id, version, state);
  }

  static fire(
    id: string,
    input: Pick<
      KotState,
      'branchId' | 'orderId' | 'kitchenStationId' | 'kotNo' | 'businessDate' | 'createdBy'
    > & {
      lineIds: readonly string[];
      /** Longest prep time among the items, if any has one. */
      prepTimeSec: number | null;
    },
    at: Date,
  ): Kot {
    if (input.lineIds.length === 0)
      throw new DomainError('NOTHING_TO_FIRE', 'a KOT needs at least one item');
    const kot = new Kot(id, 0, {
      branchId: input.branchId,
      orderId: input.orderId,
      kitchenStationId: input.kitchenStationId,
      kotNo: input.kotNo,
      businessDate: input.businessDate,
      createdBy: input.createdBy,
      status: 'NEW',
      priority: 0,
      assignedChefId: null,
      firedAt: at,
      acceptedAt: null,
      cookingAt: null,
      readyAt: null,
      servedAt: null,
      targetReadyAt: new Date(at.getTime() + (input.prepTimeSec ?? DEFAULT_PREP_SEC) * 1000),
      lines: input.lineIds.map((lineId) => ({ id: lineId, status: 'SENT', readyAt: null })),
    });
    kot.raise(
      'KotFired',
      {
        orderId: input.orderId,
        kotNo: input.kotNo,
        kitchenStationId: input.kitchenStationId,
        itemIds: input.lineIds,
      },
      at,
    );
    return kot;
  }

  get state(): Readonly<KotState> {
    return this.s;
  }

  /** Item status changes since loading. */
  lineChanges(): KotLineChange[] {
    return [...this.changes.values()];
  }

  moveTo(to: KotStatus, actorId: string | null, at: Date): void {
    const from = this.s.status;
    const fromIndex = FLOW.indexOf(from);
    const toIndex = FLOW.indexOf(to);
    if (from === 'CANCELLED' || toIndex <= fromIndex) {
      throw new DomainError('INVALID_STATE_TRANSITION', `a KOT can't go from ${from} to ${to}`, {
        from,
        to,
      });
    }
    this.s.status = to;
    if (to === 'ACCEPTED') this.s.acceptedAt = at;
    if (to === 'COOKING') this.s.cookingAt = at;
    if (to === 'READY') this.s.readyAt = at;
    if (to === 'SERVED') {
      this.s.servedAt = at;
      this.s.readyAt ??= at;
    }
    const itemStatus: OrderItemStatus | null =
      to === 'COOKING' ? 'PREPARING' : to === 'READY' ? 'READY' : to === 'SERVED' ? 'SERVED' : null;
    if (itemStatus) {
      for (const line of this.liveLines()) {
        if (itemStatus === 'PREPARING' && line.status !== 'SENT') continue;
        line.status = itemStatus;
        if (itemStatus !== 'PREPARING') line.readyAt ??= at;
        this.track(line);
      }
    }
    this.raise('KotStatusChanged', { from, to, actorId, orderId: this.s.orderId }, at);
  }

  /** Item-level bump on the KDS. When it is the last item, the ticket becomes READY too. */
  bumpLine(lineId: string, actorId: string | null, at: Date): void {
    const line = this.lineOf(lineId);
    if (line.status === 'CANCELLED' || line.status === 'READY' || line.status === 'SERVED') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `this item is already ${line.status.toLowerCase()}`,
      );
    }
    if (this.s.status === 'CANCELLED' || this.s.status === 'SERVED') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `this KOT is ${this.s.status.toLowerCase()}`,
      );
    }
    line.status = 'READY';
    line.readyAt = at;
    this.track(line);
    this.raise('KotItemReady', { itemId: lineId, orderId: this.s.orderId }, at);
    const allReady = this.liveLines().every((l) => l.status === 'READY' || l.status === 'SERVED');
    if (allReady && FLOW.indexOf(this.s.status) < FLOW.indexOf('READY'))
      this.moveTo('READY', actorId, at);
  }

  /** The order cancelled one of this ticket's items. A ticket left with no items is cancelled. */
  cancelLine(lineId: string, at: Date): void {
    const line = this.lineOf(lineId);
    if (line.status === 'CANCELLED') return;
    line.status = 'CANCELLED';
    this.raise('KotItemCancelled', { itemId: lineId, orderId: this.s.orderId }, at);
    if (this.liveLines().length === 0) this.cancel(at);
  }

  cancel(at: Date): void {
    if (this.s.status === 'CANCELLED') return;
    const from = this.s.status;
    for (const line of this.s.lines) line.status = 'CANCELLED';
    this.s.status = 'CANCELLED';
    this.raise(
      'KotStatusChanged',
      { from, to: 'CANCELLED', actorId: null, orderId: this.s.orderId },
      at,
    );
  }

  assignChef(chefId: string | null, at: Date): void {
    if (this.s.status === 'CANCELLED' || this.s.status === 'SERVED') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `this KOT is ${this.s.status.toLowerCase()}`,
      );
    }
    this.s.assignedChefId = chefId;
    this.raise('KotChefAssigned', { chefId, orderId: this.s.orderId }, at);
  }

  /** Moved to another order by a table merge. */
  reassignOrder(orderId: string, at: Date): void {
    this.s.orderId = orderId;
    this.raise('KotOrderChanged', { orderId }, at);
  }

  private liveLines(): KotLine[] {
    return this.s.lines.filter((l) => l.status !== 'CANCELLED');
  }

  private lineOf(id: string): KotLine {
    const line = this.s.lines.find((l) => l.id === id);
    if (!line) throw new DomainError('NOT_FOUND', 'item not on this KOT');
    return line;
  }

  private track(line: KotLine): void {
    this.changes.set(line.id, { id: line.id, status: line.status, readyAt: line.readyAt });
  }
}
