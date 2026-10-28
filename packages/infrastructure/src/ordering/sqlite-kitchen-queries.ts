import type { KitchenMetricsView, KitchenQueries, KotView } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

const ACTIVE = "('NEW','ACCEPTED','COOKING','READY')";
const COOKING = "('NEW','ACCEPTED','COOKING')";

type KotRow = Omit<KotView, 'items'>;
type ItemRow = KotView['items'][number] & { kotId: string; addons: string };

const KOT_SQL = `
  SELECT k.id, k.kot_no AS kotNo, k.business_date AS businessDate, k.order_id AS orderId, o.order_no AS orderNo,
         o.order_type AS orderType, t.label AS tableLabel, o.token_no AS tokenNo, o.captain_id AS captainId,
         cu.full_name AS captainName, k.kitchen_station_id AS kitchenStationId, s.name AS stationName, k.status,
         k.priority, k.assigned_chef_id AS assignedChefId, ch.full_name AS assignedChefName, k.fired_at AS firedAt,
         k.accepted_at AS acceptedAt, k.cooking_at AS cookingAt, k.ready_at AS readyAt, k.served_at AS servedAt,
         k.target_ready_at AS targetReadyAt, k.version
    FROM kots k
    JOIN orders o ON o.id = k.order_id
    LEFT JOIN dining_tables t ON t.id = o.dining_table_id
    LEFT JOIN users cu ON cu.id = o.captain_id
    LEFT JOIN users ch ON ch.id = k.assigned_chef_id
    LEFT JOIN kitchen_stations s ON s.id = k.kitchen_station_id`;

/** Kitchen read models: the KDS board, metrics, chefs and the token display. */
export class SqliteKitchenQueries implements KitchenQueries {
  constructor(private readonly db: SqliteDatabase) {}

  kot(branchId: string, id: string): KotView | undefined {
    const row = this.db
      .prepare<[string, string], KotRow>(`${KOT_SQL} WHERE k.id = ? AND k.branch_id = ?`)
      .get(id, branchId);
    return row && this.withItems([row])[0];
  }

  active(branchId: string, stationId?: string): KotView[] {
    const rows = stationId
      ? this.db
          .prepare<[string, string], KotRow>(
            `${KOT_SQL} WHERE k.branch_id = ? AND k.status IN ${ACTIVE} AND k.kitchen_station_id = ? ORDER BY k.fired_at, k.kot_no`,
          )
          .all(branchId, stationId)
      : this.db
          .prepare<[string], KotRow>(
            `${KOT_SQL} WHERE k.branch_id = ? AND k.status IN ${ACTIVE} ORDER BY k.fired_at, k.kot_no`,
          )
          .all(branchId);
    return this.withItems(rows);
  }

  overdue(branchId: string | null, now: Date) {
    return this.db
      .prepare<
        [string | null, string | null, string],
        { id: string; branchId: string; targetReadyAt: string }
      >(
        `SELECT id, branch_id AS branchId, target_ready_at AS targetReadyAt FROM kots
          WHERE (? IS NULL OR branch_id = ?) AND status IN ${COOKING} AND target_ready_at < ?`,
      )
      .all(branchId, branchId, now.toISOString())
      .map((r) => ({ ...r, targetReadyAt: new Date(r.targetReadyAt) }));
  }

  metrics(branchId: string, businessDate: string, now: Date): KitchenMetricsView {
    const counts = this.db
      .prepare<[string, string, string], { pending: number; delayed: number }>(
        `SELECT count(*) AS pending, coalesce(sum(target_ready_at < ?), 0) AS delayed
           FROM kots WHERE branch_id = ? AND status IN ${COOKING} AND business_date = ?`,
      )
      .get(now.toISOString(), branchId, businessDate)!;
    const done = this.db
      .prepare<[string, string], { completed: number; avg: number | null }>(
        `SELECT count(*) AS completed, avg((julianday(ready_at) - julianday(fired_at)) * 86400) AS avg
           FROM kots WHERE branch_id = ? AND business_date = ? AND ready_at IS NOT NULL AND status <> 'CANCELLED'`,
      )
      .get(branchId, businessDate)!;
    const perChef = this.db
      .prepare<
        [string, string],
        { chefId: string; fullName: string; completed: number; avg: number | null }
      >(
        `SELECT k.assigned_chef_id AS chefId, u.full_name AS fullName, count(k.ready_at) AS completed,
                avg((julianday(k.ready_at) - julianday(k.fired_at)) * 86400) AS avg
           FROM kots k JOIN users u ON u.id = k.assigned_chef_id
          WHERE k.branch_id = ? AND k.business_date = ? AND k.status <> 'CANCELLED'
          GROUP BY k.assigned_chef_id ORDER BY u.full_name`,
      )
      .all(branchId, businessDate);
    const round = (v: number | null) => (v === null ? null : Math.round(v));
    return {
      businessDate,
      pending: counts.pending,
      delayed: counts.delayed,
      avgCookSeconds: round(done.avg),
      completed: done.completed,
      perChef: perChef.map((c) => ({
        chefId: c.chefId,
        fullName: c.fullName,
        completed: c.completed,
        avgCookSeconds: round(c.avg),
      })),
    };
  }

  chefs(branchId: string) {
    return this.db
      .prepare<[string], { id: string; fullName: string }>(
        `SELECT DISTINCT u.id, u.full_name AS fullName
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id AND ur.branch_id = ?
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id AND p.code = 'kds.update_status'
          WHERE u.is_active = 1 AND u.deleted_at IS NULL
          ORDER BY u.full_name`,
      )
      .all(branchId);
  }

  isChef(branchId: string, userId: string): boolean {
    return this.chefs(branchId).some((c) => c.id === userId);
  }

  tokenBoard(branchId: string, businessDate: string) {
    const rows = this.db
      .prepare<
        [string, string],
        { tokenNo: number; live: number; ready: number; readyAt: string | null }
      >(
        `SELECT o.token_no AS tokenNo,
                sum(i.status IN ('SENT','PREPARING','READY')) AS live,
                sum(i.status = 'READY') AS ready,
                max(i.ready_at) AS readyAt
           FROM orders o JOIN order_items i ON i.order_id = o.id
          WHERE o.branch_id = ? AND o.business_date = ? AND o.status = 'OPEN' AND o.token_no IS NOT NULL
          GROUP BY o.id`,
      )
      .all(branchId, businessDate);
    const live = rows.filter((r) => r.live > 0);
    return {
      preparing: live
        .filter((r) => r.ready < r.live)
        .map((r) => r.tokenNo)
        .sort((a, b) => a - b),
      ready: live
        .filter((r) => r.ready === r.live)
        .sort((a, b) => (b.readyAt ?? '').localeCompare(a.readyAt ?? ''))
        .map((r) => r.tokenNo),
    };
  }

  private withItems(rows: KotRow[]): KotView[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const items = this.db
      .prepare<string[], ItemRow>(
        `SELECT i.kot_id AS kotId, i.id, i.menu_item_id AS menuItemId, i.variant_id AS variantId, i.item_name AS name, i.variant_name AS variantName, i.food_type AS foodType,
                i.quantity, i.special_note AS specialNote, i.course, i.status, i.cancel_reason AS cancelReason,
                coalesce((SELECT json_group_array(json_object('name', a.addon_name, 'quantity', a.quantity))
                            FROM order_item_addons a WHERE a.order_item_id = i.id), '[]') AS addons
           FROM order_items i WHERE i.kot_id IN (${ids.map(() => '?').join(',')})
          ORDER BY i.course, i.created_at, i.rowid`,
      )
      .all(...ids);
    const byKot = new Map<string, KotView['items']>();
    for (const { kotId, addons, ...item } of items) {
      const list = byKot.get(kotId) ?? [];
      list.push({ ...item, addons: JSON.parse(addons) as KotView['items'][number]['addons'] });
      byKot.set(kotId, list);
    }
    return rows.map((r) => ({ ...r, items: byKot.get(r.id) ?? [] }));
  }
}
