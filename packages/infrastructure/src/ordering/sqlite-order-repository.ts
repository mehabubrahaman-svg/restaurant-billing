import type { OrderRepository } from '@restroos/application';
import {
  addonsTotalOf,
  lineTotalOf,
  Order,
  type OrderLine,
  type OrderState,
} from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';
import { uuidv7Generator } from '../system/uuidv7-generator';

interface OrderRow {
  id: string;
  branch_id: string;
  order_no: string;
  token_no: number | null;
  business_date: string;
  order_type: OrderState['orderType'];
  source: OrderState['source'];
  dining_table_id: string | null;
  captain_id: string | null;
  covers: number | null;
  status: OrderState['status'];
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  merged_into_order_id: string | null;
  created_by: string;
  version: number;
}

interface LineRow {
  id: string;
  menu_item_id: string;
  variant_id: string | null;
  item_name: string;
  variant_name: string | null;
  food_type: OrderLine['foodType'];
  unit_price: number;
  quantity: number;
  tax_group_id: string | null;
  kitchen_station_id: string | null;
  prep_time_sec: number | null;
  special_note: string | null;
  course: number;
  status: OrderLine['status'];
  kot_id: string | null;
  is_wastage: number;
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  ready_at: string | null;
  created_at: string;
  created_by: string;
  version: number;
  addons_json: string;
}

const date = (v: string | null) => (v === null ? null : new Date(v));
const iso = (v: Date | null) => v?.toISOString() ?? null;

export class SqliteOrderRepository implements OrderRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => Date,
  ) {}

  get(branchId: string, id: string): Order | undefined {
    const row = this.db
      .prepare<[string, string], OrderRow>('SELECT * FROM orders WHERE id = ? AND branch_id = ?')
      .get(id, branchId);
    if (!row) return undefined;
    const lines = this.db
      .prepare<[string], LineRow>(
        `SELECT oi.*, m.prep_time_sec,
                coalesce((SELECT json_group_array(json_object('addonId', a.addon_id, 'name', a.addon_name,
                                                              'price', a.price, 'quantity', a.quantity))
                            FROM order_item_addons a WHERE a.order_item_id = oi.id), '[]') AS addons_json
           FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
          WHERE oi.order_id = ? ORDER BY oi.created_at, oi.rowid`,
      )
      .all(id);
    return Order.restore(row.id, row.version, {
      branchId: row.branch_id,
      orderNo: row.order_no,
      tokenNo: row.token_no,
      businessDate: row.business_date,
      orderType: row.order_type,
      source: row.source,
      tableId: row.dining_table_id,
      captainId: row.captain_id,
      covers: row.covers,
      status: row.status,
      notes: row.notes,
      openedAt: new Date(row.opened_at),
      closedAt: date(row.closed_at),
      cancelReason: row.cancel_reason,
      cancelledBy: row.cancelled_by,
      mergedIntoOrderId: row.merged_into_order_id,
      createdBy: row.created_by,
      lines: lines.map((l) => ({
        id: l.id,
        menuItemId: l.menu_item_id,
        variantId: l.variant_id,
        name: l.item_name,
        variantName: l.variant_name,
        foodType: l.food_type,
        unitPrice: l.unit_price,
        addons: JSON.parse(l.addons_json) as OrderLine['addons'],
        taxGroupId: l.tax_group_id,
        kitchenStationId: l.kitchen_station_id,
        prepTimeSec: l.prep_time_sec,
        quantity: l.quantity,
        specialNote: l.special_note,
        course: l.course,
        status: l.status,
        kotId: l.kot_id,
        isWastage: l.is_wastage === 1,
        cancelReason: l.cancel_reason,
        cancelledBy: l.cancelled_by,
        cancelledAt: date(l.cancelled_at),
        readyAt: date(l.ready_at),
        createdAt: new Date(l.created_at),
        createdBy: l.created_by,
        version: l.version,
      })),
    });
  }

  openOrderIdForTable(branchId: string, tableId: string): string | undefined {
    return this.db
      .prepare<[string, string], string>(
        "SELECT id FROM orders WHERE branch_id = ? AND dining_table_id = ? AND status = 'OPEN' LIMIT 1",
      )
      .pluck()
      .get(branchId, tableId);
  }

  insert(order: Order): void {
    const s = order.state;
    this.db
      .prepare(
        `INSERT INTO orders (id, branch_id, order_no, token_no, business_date, order_type, source, dining_table_id,
                             captain_id, covers, status, notes, subtotal, opened_at, created_at, created_by,
                             updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        order.id,
        s.branchId,
        s.orderNo,
        s.tokenNo,
        s.businessDate,
        s.orderType,
        s.source,
        s.tableId,
        s.captainId,
        s.covers,
        s.status,
        s.notes,
        order.subtotal,
        s.openedAt.toISOString(),
        s.openedAt.toISOString(),
        s.createdBy,
        s.openedAt.toISOString(),
        order.version,
      );
    this.writeLines(order);
    order.markPersisted();
  }

  save(order: Order): void {
    const s = order.state;
    const now = this.now().toISOString();
    const result = this.db
      .prepare(
        `UPDATE orders SET dining_table_id = ?, covers = ?, status = ?, notes = ?, subtotal = ?, closed_at = ?,
                cancel_reason = ?, cancelled_by = ?, merged_into_order_id = ?, updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        s.tableId,
        s.covers,
        s.status,
        s.notes,
        order.subtotal,
        iso(s.closedAt),
        s.cancelReason,
        s.cancelledBy,
        s.mergedIntoOrderId,
        now,
        order.version,
        order.id,
        order.persistedVersion,
      );
    assertVersionMatched(result, 'Order', order.id);
    this.writeLines(order);
    order.markPersisted();
  }

  nextOrderNo(branchId: string, businessDate: string): string {
    const n = this.db
      .prepare<[string, string], number>(
        'SELECT coalesce(max(CAST(order_no AS INTEGER)), 0) + 1 FROM orders WHERE branch_id = ? AND business_date = ?',
      )
      .pluck()
      .get(branchId, businessDate)!;
    return String(n);
  }

  nextTokenNo(branchId: string, businessDate: string): number {
    return this.db
      .prepare<[string, string], number>(
        'SELECT coalesce(max(token_no), 0) + 1 FROM orders WHERE branch_id = ? AND business_date = ?',
      )
      .pluck()
      .get(branchId, businessDate)!;
  }

  private writeLines(order: Order): void {
    const exists = this.db
      .prepare<[string], number>('SELECT 1 FROM order_items WHERE id = ?')
      .pluck();
    const upsert = this.db.prepare(
      `INSERT INTO order_items (id, order_id, menu_item_id, variant_id, item_name, variant_name, food_type, unit_price,
                                quantity, addons_total, line_total, tax_group_id, kitchen_station_id, special_note,
                                course, status, kot_id, is_wastage, cancel_reason, cancelled_by, cancelled_at, ready_at,
                                created_at, created_by, updated_at, updated_by, version)
       VALUES (@id, @orderId, @menuItemId, @variantId, @name, @variantName, @foodType, @unitPrice, @quantity,
               @addonsTotal, @lineTotal, @taxGroupId, @kitchenStationId, @specialNote, @course, @status, @kotId,
               @isWastage, @cancelReason, @cancelledBy, @cancelledAt, @readyAt, @createdAt, @createdBy, @updatedAt,
               @updatedBy, @version)
       ON CONFLICT (id) DO UPDATE SET
         order_id = excluded.order_id, quantity = excluded.quantity, addons_total = excluded.addons_total,
         line_total = excluded.line_total, special_note = excluded.special_note, course = excluded.course,
         status = excluded.status, kot_id = excluded.kot_id, is_wastage = excluded.is_wastage,
         cancel_reason = excluded.cancel_reason, cancelled_by = excluded.cancelled_by,
         cancelled_at = excluded.cancelled_at, ready_at = excluded.ready_at, updated_at = excluded.updated_at,
         updated_by = excluded.updated_by, version = excluded.version`,
    );
    const addAddon = this.db.prepare(
      `INSERT INTO order_item_addons (id, order_item_id, addon_id, addon_name, price, quantity)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const now = this.now().toISOString();
    for (const id of order.dirtyLineIds) {
      const l = order.line(id);
      const isNew = exists.get(id) === undefined;
      upsert.run({
        id,
        orderId: order.id,
        menuItemId: l.menuItemId,
        variantId: l.variantId,
        name: l.name,
        variantName: l.variantName,
        foodType: l.foodType,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        addonsTotal: addonsTotalOf(l),
        lineTotal: lineTotalOf(l),
        taxGroupId: l.taxGroupId,
        kitchenStationId: l.kitchenStationId,
        specialNote: l.specialNote,
        course: l.course,
        status: l.status,
        kotId: l.kotId,
        isWastage: l.isWastage ? 1 : 0,
        cancelReason: l.cancelReason,
        cancelledBy: l.cancelledBy,
        cancelledAt: iso(l.cancelledAt),
        readyAt: iso(l.readyAt),
        createdAt: l.createdAt.toISOString(),
        createdBy: l.createdBy,
        updatedAt: now,
        updatedBy: l.cancelledBy,
        version: l.version,
      });
      if (isNew) {
        for (const a of l.addons)
          addAddon.run(uuidv7Generator.next(), id, a.addonId, a.name, a.price, a.quantity);
      }
    }
  }
}
