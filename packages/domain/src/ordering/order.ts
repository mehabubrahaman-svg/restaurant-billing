import { AggregateRoot } from '../shared/aggregate-root';
import { DomainError } from '../shared/result';

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'QR_SELF' | 'KIOSK';
export type OrderStatus = 'PENDING_APPROVAL' | 'OPEN' | 'BILLED' | 'PAID' | 'CANCELLED' | 'VOID';
export type OrderItemStatus = 'PENDING' | 'SENT' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
export type FoodType = 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN' | 'NA';

export interface OrderLineAddon {
  readonly addonId: string;
  readonly name: string;
  /** Paise per unit of the parent item. */
  readonly price: number;
  readonly quantity: number;
}

/** One line on an order. Names and prices are snapshots taken when it was added. */
export interface OrderLine {
  readonly id: string;
  readonly menuItemId: string;
  readonly variantId: string | null;
  readonly name: string;
  readonly variantName: string | null;
  readonly foodType: FoodType;
  readonly unitPrice: number;
  readonly addons: readonly OrderLineAddon[];
  readonly taxGroupId: string | null;
  /** Where the item will be cooked; fixed when it is fired. */
  readonly kitchenStationId: string | null;
  readonly prepTimeSec: number | null;
  quantity: number;
  specialNote: string | null;
  course: number;
  status: OrderItemStatus;
  kotId: string | null;
  isWastage: boolean;
  cancelReason: string | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
  readyAt: Date | null;
  readonly createdAt: Date;
  readonly createdBy: string;
  version: number;
}

export type NewOrderLine = Omit<
  OrderLine,
  | 'status'
  | 'kotId'
  | 'isWastage'
  | 'cancelReason'
  | 'cancelledBy'
  | 'cancelledAt'
  | 'readyAt'
  | 'version'
>;

export interface OrderState {
  branchId: string;
  orderNo: string;
  tokenNo: number | null;
  businessDate: string;
  orderType: OrderType;
  source: 'POS' | 'CAPTAIN' | 'QR' | 'KIOSK' | 'ONLINE' | 'AGGREGATOR';
  tableId: string | null;
  /** Swiggy, Zomato… (null = direct). */
  salesChannelId: string | null;
  externalOrderId: string | null;
  externalOtp: string | null;
  captainId: string | null;
  covers: number | null;
  status: OrderStatus;
  notes: string | null;
  openedAt: Date;
  closedAt: Date | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  mergedIntoOrderId: string | null;
  createdBy: string;
  lines: OrderLine[];
}

export const addonsTotalOf = (line: Pick<OrderLine, 'addons'>): number =>
  line.addons.reduce((sum, a) => sum + a.price * a.quantity, 0);
export const lineTotalOf = (line: Pick<OrderLine, 'addons' | 'unitPrice' | 'quantity'>): number =>
  (line.unitPrice + addonsTotalOf(line)) * line.quantity;

const SENT_STATUSES: readonly OrderItemStatus[] = ['SENT', 'PREPARING', 'READY', 'SERVED'];
export const isSent = (status: OrderItemStatus) => SENT_STATUSES.includes(status);

/**
 * The open tab of a table, a takeaway or a delivery (docs/03 §4.1). Items
 * collect on the pad as PENDING and are fired to the kitchen in batches. Lines
 * are never deleted: a removed or cancelled line stays as CANCELLED, with who
 * and why, so the audit trail and wastage reports stay complete.
 */
export class Order extends AggregateRoot {
  readonly aggregateType = 'Order';
  /** Lines changed since loading, for the repository. */
  private readonly dirty = new Set<string>();

  private constructor(
    id: string,
    version: number,
    private readonly s: OrderState,
  ) {
    super(id, version);
  }

  static restore(id: string, version: number, state: OrderState): Order {
    return new Order(id, version, state);
  }

  static open(
    id: string,
    input: Omit<
      OrderState,
      'status' | 'closedAt' | 'cancelReason' | 'cancelledBy' | 'mergedIntoOrderId' | 'lines'
    >,
  ): Order {
    if (input.orderType === 'DINE_IN' && !input.tableId) {
      throw new DomainError('VALIDATION_FAILED', 'a dine-in order needs a table');
    }
    const order = new Order(id, 0, {
      ...input,
      status: 'OPEN',
      closedAt: null,
      cancelReason: null,
      cancelledBy: null,
      mergedIntoOrderId: null,
      lines: [],
    });
    order.raise(
      'OrderOpened',
      {
        orderNo: input.orderNo,
        tokenNo: input.tokenNo,
        orderType: input.orderType,
        tableId: input.tableId,
        covers: input.covers,
      },
      input.openedAt,
    );
    return order;
  }

  get state(): Readonly<OrderState> {
    return this.s;
  }

  get lines(): readonly OrderLine[] {
    return this.s.lines;
  }

  /** Line ids changed or added since loading. */
  get dirtyLineIds(): ReadonlySet<string> {
    return this.dirty;
  }

  line(id: string): OrderLine {
    const line = this.s.lines.find((l) => l.id === id);
    if (!line) throw new DomainError('NOT_FOUND', 'order item not found');
    return line;
  }

  /** Before tax, charges and discounts: every line that isn't cancelled. */
  get subtotal(): number {
    return this.live().reduce((sum, l) => sum + lineTotalOf(l), 0);
  }

  get itemCount(): number {
    return this.live().reduce((n, l) => n + l.quantity, 0);
  }

  pendingLines(): OrderLine[] {
    return this.s.lines.filter((l) => l.status === 'PENDING');
  }

  /** Something already went to the kitchen, so cancelling needs a manager. */
  get hasSentItems(): boolean {
    return this.s.lines.some((l) => isSent(l.status));
  }

  update(
    patch: { covers?: number | null | undefined; notes?: string | null | undefined },
    at: Date,
  ) {
    this.assertOpen();
    if (patch.covers !== undefined) this.s.covers = patch.covers;
    if (patch.notes !== undefined) this.s.notes = patch.notes;
    this.raise('OrderUpdated', { covers: this.s.covers, notes: this.s.notes }, at);
  }

  addLines(lines: readonly NewOrderLine[], at: Date): void {
    this.assertOpen();
    if (lines.length === 0) return;
    for (const line of lines) {
      if (line.quantity < 1)
        throw new DomainError('VALIDATION_FAILED', 'quantity must be at least 1');
      this.s.lines.push({
        ...line,
        status: 'PENDING',
        kotId: null,
        isWastage: false,
        cancelReason: null,
        cancelledBy: null,
        cancelledAt: null,
        readyAt: null,
        version: 1,
      });
      this.dirty.add(line.id);
    }
    this.raise('OrderItemsAdded', { itemIds: lines.map((l) => l.id) }, at);
  }

  updateLine(
    id: string,
    expectedVersion: number,
    patch: {
      quantity?: number | undefined;
      specialNote?: string | null | undefined;
      course?: number | undefined;
    },
    at: Date,
  ): OrderLine {
    this.assertOpen();
    const line = this.line(id);
    assertLineVersion(line, expectedVersion);
    if (line.status !== 'PENDING') {
      throw new DomainError(
        'ITEM_ALREADY_SENT',
        'this item is already with the kitchen; cancel it instead',
      );
    }
    if (patch.quantity !== undefined) line.quantity = patch.quantity;
    if (patch.specialNote !== undefined) line.specialNote = patch.specialNote;
    if (patch.course !== undefined) line.course = patch.course;
    line.version += 1;
    this.dirty.add(id);
    this.raise(
      'OrderItemChanged',
      { itemId: id, quantity: line.quantity, specialNote: line.specialNote },
      at,
    );
    return line;
  }

  /**
   * Removes a line. A PENDING line just goes; one the kitchen already has
   * needs a reason (and, in the application layer, a manager's permission).
   * Returns whether the kitchen had it.
   */
  cancelLine(
    id: string,
    expectedVersion: number,
    input: { reason: string | null; isWastage: boolean; by: string | null },
    at: Date,
  ): { wasSent: boolean; line: OrderLine } {
    this.assertOpen();
    const line = this.line(id);
    assertLineVersion(line, expectedVersion);
    if (line.status === 'CANCELLED') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'this item is already cancelled');
    }
    const wasSent = isSent(line.status);
    if (wasSent && !input.reason) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'give a reason for cancelling an item the kitchen already has',
      );
    }
    line.status = 'CANCELLED';
    line.cancelReason = input.reason;
    line.cancelledBy = input.by;
    line.cancelledAt = at;
    line.isWastage = wasSent && input.isWastage;
    line.version += 1;
    this.dirty.add(id);
    this.raise(
      'OrderItemCancelled',
      { itemId: id, kotId: line.kotId, wasSent, reason: input.reason, isWastage: line.isWastage },
      at,
    );
    return { wasSent, line };
  }

  /** Called by FireKot: these PENDING lines are now on the given KOT. */
  markSent(assignments: ReadonlyMap<string, string>, at: Date): void {
    this.assertOpen();
    for (const [lineId, kotId] of assignments) {
      const line = this.line(lineId);
      if (line.status !== 'PENDING') {
        throw new DomainError('ITEM_ALREADY_SENT', 'an item was already sent');
      }
      line.status = 'SENT';
      line.kotId = kotId;
      this.dirty.add(lineId);
    }
    this.raise('OrderItemsSent', { kotIds: [...new Set(assignments.values())] }, at);
  }

  cancel(input: { reason: string; by: string | null }, at: Date): OrderLine[] {
    this.assertOpen();
    const cancelled: OrderLine[] = [];
    for (const line of this.s.lines) {
      if (line.status === 'CANCELLED') continue;
      line.status = 'CANCELLED';
      line.cancelReason = input.reason;
      line.cancelledBy = input.by;
      line.cancelledAt = at;
      line.version += 1;
      this.dirty.add(line.id);
      cancelled.push(line);
    }
    this.s.status = 'CANCELLED';
    this.s.cancelReason = input.reason;
    this.s.cancelledBy = input.by;
    this.s.closedAt = at;
    this.raise('OrderCancelled', { reason: input.reason, tableId: this.s.tableId }, at);
    return cancelled;
  }

  moveToTable(tableId: string, at: Date): string | null {
    this.assertOpen();
    if (this.s.orderType !== 'DINE_IN') {
      throw new DomainError('VALIDATION_FAILED', 'only dine-in orders sit at a table');
    }
    const from = this.s.tableId;
    if (from === tableId)
      throw new DomainError('VALIDATION_FAILED', 'the order is already at this table');
    this.s.tableId = tableId;
    this.raise('OrderTableMoved', { from, to: tableId }, at);
    return from;
  }

  /** Moves every line (and so its KOTs) into `target` and closes this order. */
  mergeInto(target: Order, at: Date): OrderLine[] {
    this.assertOpen();
    target.assertOpen();
    if (target.id === this.id)
      throw new DomainError('VALIDATION_FAILED', 'an order cannot merge into itself');
    const moved = this.s.lines;
    for (const line of moved) {
      target.s.lines.push(line);
      target.dirty.add(line.id);
    }
    this.s.lines = [];
    if (this.s.covers !== null) target.s.covers = (target.s.covers ?? 0) + this.s.covers;
    target.raise('OrderMergedIn', { fromOrderId: this.id, itemIds: moved.map((l) => l.id) }, at);
    this.s.status = 'CANCELLED';
    this.s.cancelReason = `merged into order ${target.s.orderNo}`;
    this.s.mergedIntoOrderId = target.id;
    this.s.closedAt = at;
    this.raise('OrderMerged', { intoOrderId: target.id, tableId: this.s.tableId }, at);
    return moved;
  }

  /** Bill generated: nothing may change until the bill is paid or cancelled. */
  markBilled(at: Date): void {
    this.assertOpen();
    if (this.pendingLines().length > 0) {
      throw new DomainError(
        'ORDER_HAS_UNSENT_ITEMS',
        'send or remove the items still on the pad before billing',
      );
    }
    if (this.live().length === 0)
      throw new DomainError('NOTHING_TO_BILL', 'the order has no items to bill');
    this.s.status = 'BILLED';
    this.raise('OrderBilled', { subtotal: this.subtotal }, at);
  }

  /** The bill was cancelled before payment: the order can change again. */
  /** Its bill was cancelled: billed, or paid in the same shift (the payments are reversed). */
  reopen(at: Date): void {
    if (this.s.status !== 'BILLED' && this.s.status !== 'PAID') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `a ${this.s.status.toLowerCase()} order can't be reopened`,
      );
    }
    this.s.status = 'OPEN';
    this.s.closedAt = null;
    this.raise('OrderReopened', {}, at);
  }

  markPaid(at: Date): void {
    if (this.s.status !== 'BILLED') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `a ${this.s.status.toLowerCase()} order can't be paid`,
      );
    }
    this.s.status = 'PAID';
    this.s.closedAt = at;
    this.raise('OrderPaid', { tableId: this.s.tableId }, at);
  }

  private live(): OrderLine[] {
    return this.s.lines.filter((l) => l.status !== 'CANCELLED');
  }

  private assertOpen(): void {
    if (this.s.status !== 'OPEN') {
      throw new DomainError(
        'ORDER_NOT_OPEN',
        `this order is ${this.s.status.toLowerCase()} and can't change`,
      );
    }
  }
}

function assertLineVersion(line: OrderLine, expected: number): void {
  if (line.version !== expected) {
    throw new DomainError(
      'VERSION_CONFLICT',
      'this item was changed by someone else; reload and try again',
    );
  }
}
