import type {
  KotSummaryView,
  OrderItemView,
  OrderQueries,
  OrderSummaryView,
  OrderView,
  TableOrderView,
} from '@restroos/application';
import type { OrderStatus } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';

interface SummaryRow {
  id: string;
  order_no: string;
  token_no: number | null;
  business_date: string;
  order_type: OrderSummaryView['orderType'];
  status: OrderStatus;
  dining_table_id: string | null;
  table_label: string | null;
  covers: number | null;
  captain_id: string | null;
  captain_name: string | null;
  notes: string | null;
  subtotal: number;
  item_count: number;
  pending_count: number;
  ready_count: number;
  opened_at: string;
  closed_at: string | null;
  version: number;
}

const SUMMARY_SQL = `
  SELECT o.id, o.order_no, o.token_no, o.business_date, o.order_type, o.status, o.dining_table_id,
         t.label AS table_label, o.covers, o.captain_id, u.full_name AS captain_name, o.notes,
         coalesce(sum(CASE WHEN i.status <> 'CANCELLED' THEN i.line_total END), 0) AS subtotal,
         coalesce(sum(CASE WHEN i.status <> 'CANCELLED' THEN i.quantity END), 0) AS item_count,
         coalesce(sum(CASE WHEN i.status = 'PENDING' THEN i.quantity END), 0) AS pending_count,
         coalesce(sum(CASE WHEN i.status = 'READY' THEN i.quantity END), 0) AS ready_count,
         o.opened_at, o.closed_at, o.version
    FROM orders o
    LEFT JOIN dining_tables t ON t.id = o.dining_table_id
    LEFT JOIN users u ON u.id = o.captain_id
    LEFT JOIN order_items i ON i.order_id = o.id`;

const toSummary = (r: SummaryRow): OrderSummaryView => ({
  id: r.id,
  orderNo: r.order_no,
  tokenNo: r.token_no,
  businessDate: r.business_date,
  orderType: r.order_type,
  status: r.status,
  tableId: r.dining_table_id,
  tableLabel: r.table_label,
  covers: r.covers,
  captainId: r.captain_id,
  captainName: r.captain_name,
  notes: r.notes,
  subtotal: r.subtotal,
  itemCount: r.item_count,
  pendingCount: r.pending_count,
  readyCount: r.ready_count,
  openedAt: r.opened_at,
  closedAt: r.closed_at,
  version: r.version,
});

export class SqliteOrderQueries implements OrderQueries {
  constructor(private readonly db: SqliteDatabase) {}

  summary(branchId: string, id: string): OrderSummaryView | undefined {
    const row = this.db
      .prepare<[string, string], SummaryRow>(
        `${SUMMARY_SQL} WHERE o.id = ? AND o.branch_id = ? GROUP BY o.id`,
      )
      .get(id, branchId);
    return row && toSummary(row);
  }

  summaries(branchId: string, status: OrderStatus): OrderSummaryView[] {
    return this.db
      .prepare<[string, string], SummaryRow>(
        `${SUMMARY_SQL} WHERE o.branch_id = ? AND o.status = ? GROUP BY o.id ORDER BY o.opened_at`,
      )
      .all(branchId, status)
      .map(toSummary);
  }

  order(branchId: string, id: string): OrderView | undefined {
    const summary = this.summary(branchId, id);
    if (!summary) return undefined;
    const items = this.db
      .prepare<[string], Omit<OrderItemView, 'addons'> & { addons: string }>(
        `SELECT i.id, i.menu_item_id AS menuItemId, i.variant_id AS variantId, i.item_name AS name,
                i.variant_name AS variantName, i.food_type AS foodType, i.unit_price AS unitPrice,
                coalesce((SELECT json_group_array(json_object('addonId', a.addon_id, 'name', a.addon_name,
                                                              'price', a.price, 'quantity', a.quantity))
                            FROM order_item_addons a WHERE a.order_item_id = i.id), '[]') AS addons,
                i.addons_total AS addonsTotal, i.quantity, i.line_total AS lineTotal, i.special_note AS specialNote,
                i.course, i.status, i.kot_id AS kotId, i.kitchen_station_id AS kitchenStationId,
                i.cancel_reason AS cancelReason, i.created_at AS createdAt, i.version
           FROM order_items i WHERE i.order_id = ? ORDER BY i.created_at, i.rowid`,
      )
      .all(id)
      .map((r) => ({ ...r, addons: JSON.parse(r.addons) as OrderItemView['addons'] }));
    const kots = this.db
      .prepare<[string], KotSummaryView>(
        `SELECT k.id, k.kot_no AS kotNo, k.kitchen_station_id AS kitchenStationId, s.name AS stationName,
                k.status, k.fired_at AS firedAt, k.ready_at AS readyAt, k.version
           FROM kots k LEFT JOIN kitchen_stations s ON s.id = k.kitchen_station_id
          WHERE k.order_id = ? ORDER BY k.kot_no`,
      )
      .all(id);
    return { ...summary, items, kots };
  }

  openOrdersByTable(branchId: string): Map<string, TableOrderView> {
    const rows = this.db
      .prepare<[string], SummaryRow>(
        `${SUMMARY_SQL} WHERE o.branch_id = ? AND o.status = 'OPEN' AND o.dining_table_id IS NOT NULL GROUP BY o.id`,
      )
      .all(branchId);
    return new Map(
      rows.map((r) => [
        r.dining_table_id!,
        {
          id: r.id,
          orderNo: r.order_no,
          covers: r.covers,
          subtotal: r.subtotal,
          openedAt: r.opened_at,
          captainId: r.captain_id,
          captainName: r.captain_name,
          itemCount: r.item_count,
          pendingCount: r.pending_count,
          readyCount: r.ready_count,
        },
      ]),
    );
  }
}
