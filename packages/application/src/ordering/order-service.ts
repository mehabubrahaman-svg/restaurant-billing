import { DomainError, Kot, Order, type NewOrderLine, type OrderLine } from '@restroos/domain';
import type { CatalogRepository, MenuItemRecord } from '../catalog/ports';
import type { FloorRepository, TableRecord } from '../floor/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';
import type { SalesChannelRepository } from './channels';
import type { BusinessCalendar, KotRepository, OrderRepository } from './ports';

export interface OrderServiceDeps {
  readonly orders: OrderRepository;
  readonly kots: KotRepository;
  readonly catalog: CatalogRepository;
  readonly floor: FloorRepository;
  readonly channels: SalesChannelRepository;
  readonly calendar: BusinessCalendar;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface NewItemInput {
  menuItemId: string;
  variantId?: string | undefined;
  quantity: number;
  addons: { addonId: string; quantity: number }[];
  specialNote?: string | undefined;
  course: number;
}

/** What the caller may do beyond the route's own permission (decided from their permissions or a manager's approval). */
export interface Elevation {
  /** Cancel items the kitchen already has, or an order with such items. */
  readonly mayCancelSent: boolean;
}

/**
 * Ordering commands (docs/09 WP 4.1, docs/07 §7.2). Every command loads the
 * order inside its write transaction, so two captains adding to the same
 * table never lose each other's items.
 */
export class OrderService {
  constructor(private readonly d: OrderServiceDeps) {}

  open(
    input: {
      orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
      tableId?: string | undefined;
      covers?: number | undefined;
      notes?: string | undefined;
      source: 'POS' | 'CAPTAIN';
    },
    ctx: CommandContext,
  ): Order {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const businessDate = this.d.calendar.businessDate(ctx.branchId, now);
      const id = this.d.ids.next();
      let table: TableRecord | undefined;
      if (input.orderType === 'DINE_IN') {
        table = this.d.floor.table(ctx.branchId, input.tableId ?? '');
        if (!table) throw new DomainError('NOT_FOUND', 'table not found');
        if (
          !table.isActive ||
          (table.status !== 'AVAILABLE' && table.status !== 'RESERVED') ||
          this.d.orders.openOrderIdForTable(ctx.branchId, table.id)
        ) {
          throw new DomainError(
            'TABLE_NOT_FREE',
            `table ${table.label} is ${table.status.toLowerCase()}`,
          );
        }
      }
      const order = Order.open(id, {
        branchId: ctx.branchId,
        orderNo: this.d.orders.nextOrderNo(ctx.branchId, businessDate),
        tokenNo:
          input.orderType === 'DINE_IN'
            ? null
            : this.d.orders.nextTokenNo(ctx.branchId, businessDate),
        businessDate,
        orderType: input.orderType,
        source: input.source,
        tableId: table?.id ?? null,
        salesChannelId: null,
        externalOrderId: null,
        externalOtp: null,
        captainId: ctx.actorId,
        covers: input.covers ?? null,
        notes: input.notes ?? null,
        openedAt: now,
        createdBy: ctx.actorId!,
      });
      this.d.orders.insert(order);
      if (table) this.setTable(scope, ctx.branchId, table, 'OCCUPIED', id, now);
      this.finish(scope, [order], 'order.open', order, {
        orderType: input.orderType,
        tableId: input.tableId,
      });
      return order;
    });
  }

  update(
    id: string,
    patch: {
      version: number;
      covers?: number | null | undefined;
      notes?: string | null | undefined;
    },
    ctx: CommandContext,
  ): Order {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const order = this.load(ctx.branchId, id);
      if (order.version !== patch.version) throw conflict();
      const before = { covers: order.state.covers, notes: order.state.notes };
      order.update(patch, this.d.clock.now());
      this.d.orders.save(order);
      this.finish(
        scope,
        [order],
        'order.update',
        order,
        { covers: order.state.covers, notes: order.state.notes },
        before,
      );
      return order;
    });
  }

  addItems(id: string, items: readonly NewItemInput[], ctx: CommandContext): Order {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const order = this.load(ctx.branchId, id);
      const lines = items.map((item) => this.priceLine(ctx, item, now));
      order.addLines(lines, now);
      this.d.orders.save(order);
      this.finish(scope, [order], 'order.items.add', order, {
        items: lines.map((l) => ({
          id: l.id,
          name: l.name,
          variant: l.variantName,
          quantity: l.quantity,
        })),
      });
      return order;
    });
  }

  updateItem(
    id: string,
    itemId: string,
    patch: {
      version: number;
      quantity?: number | undefined;
      specialNote?: string | null | undefined;
      course?: number | undefined;
    },
    ctx: CommandContext,
  ): Order {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const order = this.load(ctx.branchId, id);
      const before = pick(order.line(itemId));
      const { version, ...rest } = patch;
      const line = order.updateLine(itemId, version, rest, this.d.clock.now());
      this.d.orders.save(order);
      this.finish(scope, [order], 'order.item.update', order, pick(line), before);
      return order;
    });
  }

  cancelItem(
    id: string,
    itemId: string,
    input: { version: number; reason?: string | undefined; isWastage: boolean },
    ctx: CommandContext,
    elevation: Elevation,
  ): Order {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const order = this.load(ctx.branchId, id);
      const current = order.line(itemId);
      if (
        current.status !== 'PENDING' &&
        current.status !== 'CANCELLED' &&
        !elevation.mayCancelSent
      ) {
        throw approvalRequired(
          'orders.item_cancel',
          'the kitchen already has this item; a manager must approve',
        );
      }
      const { wasSent, line } = order.cancelLine(
        itemId,
        input.version,
        { reason: input.reason ?? null, isWastage: input.isWastage, by: ctx.actorId },
        now,
      );
      const kots: Kot[] = [];
      if (wasSent && line.kotId) {
        const kot = this.d.kots.get(ctx.branchId, line.kotId);
        if (kot && kot.state.status !== 'SERVED') {
          kot.cancelLine(itemId, now);
          this.d.kots.save(kot, ctx.actorId);
          kots.push(kot);
        }
      }
      this.d.orders.save(order);
      scope.audit({
        action: wasSent ? 'order.item.void' : 'order.item.remove',
        entityType: 'Order',
        entityId: order.id,
        before: pick(current),
        after: { itemId, name: line.name, quantity: line.quantity, isWastage: line.isWastage },
        reason: input.reason ?? null,
      });
      scope.recordEvents([...order.pullEvents(), ...kots.flatMap((k) => k.pullEvents())]);
      return order;
    });
  }

  /** FireKot: every PENDING item, one KOT per kitchen station (docs/07 §7.2). */
  fire(id: string, ctx: CommandContext): { order: Order; kots: Kot[] } {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const order = this.load(ctx.branchId, id);
      const kots = this.fireIn(order, ctx, this.d.clock.now());
      this.d.orders.save(order);
      scope.audit({
        action: 'order.kot.fire',
        entityType: 'Order',
        entityId: order.id,
        after: {
          kots: kots.map((k) => ({ id: k.id, kotNo: k.state.kotNo, items: k.state.lines.length })),
        },
      });
      scope.recordEvents([...order.pullEvents(), ...kots.flatMap((k) => k.pullEvents())]);
      return { order, kots };
    });
  }

  /**
   * Manual entry of a Swiggy/Zomato order (docs/01 §5.10): a delivery with a
   * token, priced at the channel's markup, rejected if that channel's order id
   * was already entered, and usually sent to the kitchen at once.
   */
  openAggregator(
    input: {
      salesChannelId: string;
      externalOrderId: string;
      externalOtp?: string | undefined;
      notes?: string | undefined;
      items: readonly NewItemInput[];
      fire: boolean;
    },
    ctx: CommandContext,
  ): { order: Order; kots: Kot[] } {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const channel = this.d.channels.get(input.salesChannelId);
      if (!channel || !channel.isActive || channel.kind !== 'AGGREGATOR') {
        throw new DomainError('VALIDATION_FAILED', 'choose an active aggregator channel');
      }
      const externalOrderId = input.externalOrderId.trim();
      if (this.d.channels.existingOrderId(channel.id, externalOrderId)) {
        throw new DomainError(
          'DUPLICATE_EXTERNAL_ORDER',
          `${channel.name} order ${externalOrderId} was already entered`,
        );
      }
      const businessDate = this.d.calendar.businessDate(ctx.branchId, now);
      const order = Order.open(this.d.ids.next(), {
        branchId: ctx.branchId,
        orderNo: this.d.orders.nextOrderNo(ctx.branchId, businessDate),
        tokenNo: this.d.orders.nextTokenNo(ctx.branchId, businessDate),
        businessDate,
        orderType: 'DELIVERY',
        source: 'AGGREGATOR',
        tableId: null,
        salesChannelId: channel.id,
        externalOrderId,
        externalOtp: input.externalOtp?.trim() || null,
        captainId: ctx.actorId,
        covers: null,
        notes: input.notes ?? null,
        openedAt: now,
        createdBy: ctx.actorId!,
      });
      order.addLines(
        input.items.map((item) => this.priceLine(ctx, item, now, channel.priceMarkupBp)),
        now,
      );
      this.d.orders.insert(order);
      const kots = input.fire ? this.fireIn(order, ctx, now) : [];
      if (input.fire) this.d.orders.save(order);
      scope.audit({
        action: 'order.aggregator.open',
        entityType: 'Order',
        entityId: order.id,
        after: {
          channel: channel.code,
          externalOrderId,
          items: input.items.length,
          fired: kots.length,
        },
      });
      scope.recordEvents([...order.pullEvents(), ...kots.flatMap((k) => k.pullEvents())]);
      return { order, kots };
    });
  }

  /** FireKot inside an open transaction: one KOT per kitchen station for every PENDING line. */
  private fireIn(order: Order, ctx: CommandContext, now: Date): Kot[] {
    const pending = order.pendingLines();
    if (pending.length === 0)
      throw new DomainError('NOTHING_TO_FIRE', 'nothing new to send to the kitchen');
    const byStation = new Map<string | null, OrderLine[]>();
    for (const line of pending) {
      const group = byStation.get(line.kitchenStationId) ?? [];
      group.push(line);
      byStation.set(line.kitchenStationId, group);
    }
    const businessDate = this.d.calendar.businessDate(ctx.branchId, now);
    const kots: Kot[] = [];
    const assignments = new Map<string, string>();
    for (const [stationId, lines] of byStation) {
      const prep = lines.map((l) => l.prepTimeSec).filter((p): p is number => p !== null);
      const kot = Kot.fire(
        this.d.ids.next(),
        {
          branchId: ctx.branchId,
          orderId: order.id,
          kitchenStationId: stationId,
          kotNo: this.d.kots.nextKotNo(ctx.branchId, businessDate),
          businessDate,
          createdBy: ctx.actorId!,
          lineIds: lines.map((l) => l.id),
          prepTimeSec: prep.length > 0 ? Math.max(...prep) : null,
        },
        now,
      );
      this.d.kots.insert(kot);
      for (const line of lines) assignments.set(line.id, kot.id);
      kots.push(kot);
    }
    order.markSent(assignments, now);
    return kots;
  }

  cancel(
    id: string,
    input: { version: number; reason: string },
    ctx: CommandContext,
    elevation: Elevation,
  ): Order {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const order = this.load(ctx.branchId, id);
      if (order.version !== input.version) throw conflict();
      if (order.hasSentItems && !elevation.mayCancelSent) {
        throw approvalRequired(
          'orders.cancel',
          'the kitchen already has items from this order; a manager must approve',
        );
      }
      order.cancel({ reason: input.reason, by: ctx.actorId }, now);
      const kots = this.d.kots.forOrder(order.id).filter((k) => isLive(k));
      for (const kot of kots) {
        kot.cancel(now);
        this.d.kots.save(kot, ctx.actorId);
      }
      this.d.orders.save(order);
      this.freeTable(scope, ctx.branchId, order.state.tableId, now);
      scope.audit({
        action: 'order.cancel',
        entityType: 'Order',
        entityId: order.id,
        after: { subtotal: 0, cancelledKots: kots.map((k) => k.state.kotNo) },
        reason: input.reason,
      });
      scope.recordEvents([...order.pullEvents(), ...kots.flatMap((k) => k.pullEvents())]);
      return order;
    });
  }

  /** MOVE to a free table, or MERGE into the open order at an occupied one. */
  transfer(
    fromTableId: string,
    input: { targetTableId: string; mode: 'MOVE' | 'MERGE' },
    ctx: CommandContext,
  ): Order {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const branchId = ctx.branchId;
      const sourceId = this.d.orders.openOrderIdForTable(branchId, fromTableId);
      if (!sourceId) throw new DomainError('NOT_FOUND', 'this table has no open order');
      const source = this.load(branchId, sourceId);
      const target = this.d.floor.table(branchId, input.targetTableId);
      if (!target || !target.isActive) throw new DomainError('NOT_FOUND', 'target table not found');
      if (target.id === fromTableId)
        throw new DomainError('VALIDATION_FAILED', 'pick a different table');

      if (input.mode === 'MOVE') {
        if (
          (target.status !== 'AVAILABLE' && target.status !== 'RESERVED') ||
          this.d.orders.openOrderIdForTable(branchId, target.id)
        ) {
          throw new DomainError(
            'TABLE_NOT_FREE',
            `table ${target.label} is ${target.status.toLowerCase()}`,
          );
        }
        source.moveToTable(target.id, now);
        this.d.orders.save(source);
        this.freeTable(scope, branchId, fromTableId, now);
        this.setTable(scope, branchId, target, 'OCCUPIED', source.id, now);
        this.finish(scope, [source], 'order.table.move', source, {
          from: fromTableId,
          to: target.id,
        });
        return source;
      }

      const targetOrderId = this.d.orders.openOrderIdForTable(branchId, target.id);
      if (!targetOrderId)
        throw new DomainError(
          'VALIDATION_FAILED',
          `table ${target.label} has no open order to merge into`,
        );
      const into = this.load(branchId, targetOrderId);
      const moved = source.mergeInto(into, now);
      const kots = this.d.kots.forOrder(source.id);
      for (const kot of kots) {
        kot.reassignOrder(into.id, now);
        this.d.kots.save(kot, ctx.actorId);
      }
      this.d.orders.save(into);
      this.d.orders.save(source);
      this.freeTable(scope, branchId, fromTableId, now);
      scope.audit({
        action: 'order.table.merge',
        entityType: 'Order',
        entityId: into.id,
        after: { fromOrderId: source.id, fromTableId, items: moved.length },
      });
      scope.recordEvents([
        ...source.pullEvents(),
        ...into.pullEvents(),
        ...kots.flatMap((k) => k.pullEvents()),
      ]);
      return into;
    });
  }

  // ---- helpers -------------------------------------------------------------------------------
  private load(branchId: string, id: string): Order {
    const order = this.d.orders.get(branchId, id);
    if (!order) throw new DomainError('NOT_FOUND', 'order not found');
    return order;
  }

  /** Snapshot name, price, tax group and station from the menu; checks variant and add-on rules. */
  private priceLine(
    ctx: CommandContext,
    input: NewItemInput,
    now: Date,
    markupBp = 0,
  ): NewOrderLine {
    const line = this.basePriceLine(ctx, input, now);
    if (markupBp === 0) return line;
    const up = (paise: number) => paise + Math.round((paise * markupBp) / 10_000);
    return {
      ...line,
      unitPrice: up(line.unitPrice),
      addons: line.addons.map((a) => ({ ...a, price: up(a.price) })),
    };
  }

  private basePriceLine(ctx: CommandContext, input: NewItemInput, now: Date): NewOrderLine {
    const item = this.d.catalog.item(ctx.branchId, input.menuItemId);
    if (!item) throw new DomainError('NOT_FOUND', 'menu item not found');
    if (!item.isActive || !item.isAvailable) {
      throw new DomainError('ITEM_UNAVAILABLE', `${item.name} is not available right now`);
    }
    let unitPrice = item.basePrice;
    let variantName: string | null = null;
    if (item.variants.length > 0) {
      const variant = item.variants.find((v) => v.id === input.variantId);
      if (!variant) throw new DomainError('VALIDATION_FAILED', `choose a size for ${item.name}`);
      unitPrice = variant.price;
      variantName = variant.name;
    } else if (input.variantId) {
      throw new DomainError('VALIDATION_FAILED', `${item.name} has no sizes`);
    }
    return {
      id: this.d.ids.next(),
      menuItemId: item.id,
      variantId: item.variants.length > 0 ? input.variantId! : null,
      name: item.name,
      variantName,
      foodType: item.foodType,
      unitPrice,
      addons: this.addons(item, input.addons),
      taxGroupId: item.taxGroupId,
      kitchenStationId: item.kitchenStationId,
      prepTimeSec: item.prepTimeSec,
      quantity: input.quantity,
      specialNote: input.specialNote?.trim() || null,
      course: input.course,
      createdAt: now,
      createdBy: ctx.actorId!,
    };
  }

  private addons(item: MenuItemRecord, chosen: readonly { addonId: string; quantity: number }[]) {
    const result: NewOrderLine['addons'][number][] = [];
    const seen = new Set<string>();
    for (const groupId of item.addonGroupIds) {
      const group = this.d.catalog.addonGroup(groupId);
      if (!group || !group.isActive) continue;
      const picked = chosen.filter((c) => group.addons.some((a) => a.id === c.addonId));
      if (picked.length < group.minSelect || picked.length > group.maxSelect) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `${group.name}: choose ${group.minSelect === group.maxSelect ? group.minSelect : `${group.minSelect}–${group.maxSelect}`}`,
        );
      }
      for (const p of picked) {
        const addon = group.addons.find((a) => a.id === p.addonId)!;
        seen.add(p.addonId);
        result.push({
          addonId: addon.id,
          name: addon.name,
          price: addon.price,
          quantity: p.quantity,
        });
      }
    }
    if (chosen.some((c) => !seen.has(c.addonId))) {
      throw new DomainError('VALIDATION_FAILED', `an add-on doesn't belong to ${item.name}`);
    }
    if (new Set(chosen.map((c) => c.addonId)).size !== chosen.length) {
      throw new DomainError('VALIDATION_FAILED', 'an add-on is listed twice; use its quantity');
    }
    return result;
  }

  private setTable(
    scope: TransactionScope,
    branchId: string,
    table: TableRecord,
    status: 'OCCUPIED' | 'AVAILABLE',
    orderId: string | null,
    now: Date,
  ): void {
    const next: TableRecord = {
      ...table,
      status,
      currentOrderId: orderId,
      version: table.version + 1,
    };
    this.d.floor.updateTable(branchId, next, now);
    scope.recordEvents([
      recordChanged(
        'TableStatusChanged',
        'DiningTable',
        table.id,
        next.version,
        { from: table.status, to: status, orderId },
        now,
      ),
    ]);
  }

  private freeTable(
    scope: TransactionScope,
    branchId: string,
    tableId: string | null,
    now: Date,
  ): void {
    if (!tableId) return;
    const table = this.d.floor.table(branchId, tableId);
    if (table) this.setTable(scope, branchId, table, 'AVAILABLE', null, now);
  }

  private finish(
    scope: TransactionScope,
    aggregates: readonly Order[],
    action: string,
    order: Order,
    after: unknown,
    before?: unknown,
  ): void {
    scope.audit({ action, entityType: 'Order', entityId: order.id, before, after });
    scope.recordEvents(aggregates.flatMap((a) => a.pullEvents()));
  }
}

const isLive = (kot: Kot) => kot.state.status !== 'SERVED' && kot.state.status !== 'CANCELLED';

function pick(line: OrderLine) {
  return {
    itemId: line.id,
    name: line.name,
    quantity: line.quantity,
    specialNote: line.specialNote,
    status: line.status,
  };
}

function conflict() {
  return new DomainError(
    'VERSION_CONFLICT',
    'this order was changed by someone else; reload and try again',
  );
}

export function approvalRequired(permission: string, message: string) {
  return new DomainError('APPROVAL_REQUIRED', message, { permission });
}
