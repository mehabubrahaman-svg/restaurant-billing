import type {
  BestsellerEntry,
  DishRatingRecord,
  DishRatingStatus,
  DishScore,
  OrderRatingRecord,
  OrderRatingView,
  RatableOrder,
  RatingRepository,
} from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

type OrderRow = Omit<RatableOrder, 'dishes' | 'rated'> & { rated: number };
type RatingRow = Omit<OrderRatingView, 'dishes' | 'guestPhoneLast4'> & { phone: string };
type DishRow = DishRatingRecord & { orderRatingId: string; name: string };

/** Guest ratings and the bestseller list (migration 0022). */
export class SqliteRatingRepository implements RatingRepository {
  constructor(private readonly db: SqliteDatabase) {}

  ordersForPhone(branchId: string, businessDate: string, phone: string): RatableOrder[] {
    const orders = this.db
      .prepare<[string, string, string], OrderRow>(
        `SELECT o.id AS orderId, o.order_no AS orderNo, t.label AS tableLabel, o.opened_at AS openedAt,
                o.captain_id AS captainId, u.full_name AS captainName, o.customer_id AS customerId,
                EXISTS (SELECT 1 FROM order_ratings r WHERE r.order_id = o.id) AS rated
           FROM orders o
           JOIN customers c ON c.id = o.customer_id
           LEFT JOIN dining_tables t ON t.id = o.dining_table_id
           LEFT JOIN users u ON u.id = o.captain_id
          WHERE o.branch_id = ? AND o.business_date = ? AND c.phone = ?
            AND o.status IN ('OPEN', 'BILLED', 'PAID')
          ORDER BY o.opened_at DESC`,
      )
      .all(branchId, businessDate, phone);
    const dishes = this.db.prepare<[string], { menuItemId: string; name: string }>(
      `SELECT menu_item_id AS menuItemId, item_name AS name
         FROM order_items WHERE order_id = ? AND status <> 'CANCELLED'
        GROUP BY menu_item_id ORDER BY min(created_at), min(rowid)`,
    );
    return orders.map((o) => ({ ...o, rated: o.rated === 1, dishes: dishes.all(o.orderId) }));
  }

  insert(r: OrderRatingRecord): void {
    this.db
      .prepare(
        `INSERT INTO order_ratings (id, branch_id, order_id, customer_id, captain_id, captain_stars, comment,
                                    business_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.orderId,
        r.customerId,
        r.captainId,
        r.captainStars,
        r.comment,
        r.businessDate,
        r.createdAt,
      );
    const dish = this.db.prepare(
      `INSERT INTO dish_ratings (id, order_rating_id, menu_item_id, stars, comment, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const d of r.dishes)
      dish.run(d.id, r.id, d.menuItemId, d.stars, d.comment, d.status, d.version);
  }

  list(
    branchId: string,
    filter: { from: string; to: string; status: DishRatingStatus | 'ALL' },
  ): OrderRatingView[] {
    const rows = this.db
      .prepare<[string, string, string, string, string], RatingRow>(
        `SELECT r.id, r.branch_id AS branchId, r.order_id AS orderId, o.order_no AS orderNo,
                r.business_date AS businessDate, r.created_at AS createdAt, t.label AS tableLabel,
                c.name AS guestName, c.phone, r.captain_id AS captainId, u.full_name AS captainName,
                r.captain_stars AS captainStars, r.comment
           FROM order_ratings r
           JOIN orders o ON o.id = r.order_id
           JOIN customers c ON c.id = r.customer_id
           LEFT JOIN dining_tables t ON t.id = o.dining_table_id
           LEFT JOIN users u ON u.id = r.captain_id
          WHERE r.branch_id = ? AND r.business_date BETWEEN ? AND ?
            AND (? = 'ALL' OR EXISTS (SELECT 1 FROM dish_ratings d WHERE d.order_rating_id = r.id AND d.status = ?))
          ORDER BY r.created_at DESC
          LIMIT 500`,
      )
      .all(branchId, filter.from, filter.to, filter.status, filter.status);
    if (rows.length === 0) return [];
    const dishes = this.db
      .prepare<[string], DishRow>(
        `SELECT d.id, d.order_rating_id AS orderRatingId, d.menu_item_id AS menuItemId, m.name, d.stars,
                d.comment, d.status, d.reviewed_at AS reviewedAt, d.reviewed_by AS reviewedBy, d.version
           FROM dish_ratings d JOIN menu_items m ON m.id = d.menu_item_id
          WHERE d.order_rating_id IN (SELECT value FROM json_each(?))
          ORDER BY d.rowid`,
      )
      .all(JSON.stringify(rows.map((r) => r.id)));
    const byRating = new Map<string, DishRow[]>();
    for (const d of dishes)
      byRating.set(d.orderRatingId, [...(byRating.get(d.orderRatingId) ?? []), d]);
    return rows.map(({ phone, ...r }) => ({
      ...r,
      guestPhoneLast4: phone.slice(-4),
      dishes: (byRating.get(r.id) ?? []).map(({ orderRatingId: _, ...d }) => d),
    }));
  }

  review(
    branchId: string,
    ids: readonly string[],
    status: DishRatingStatus,
    by: string | null,
    at: string,
  ): string[] {
    const decided = status !== 'PENDING';
    return this.db
      .prepare<[string, string | null, string | null, string, string, string], string>(
        `UPDATE dish_ratings SET status = ?, reviewed_at = ?, reviewed_by = ?, version = version + 1
          WHERE id IN (SELECT value FROM json_each(?)) AND status <> ?
            AND order_rating_id IN (SELECT id FROM order_ratings WHERE branch_id = ?)
          RETURNING id`,
      )
      .pluck()
      .all(status, decided ? at : null, decided ? by : null, JSON.stringify(ids), status, branchId);
  }

  dishScores(branchId: string): DishScore[] {
    return this.db
      .prepare<[string], DishScore>(
        `SELECT d.menu_item_id AS menuItemId, round(avg(d.stars), 1) AS average, count(*) AS count
           FROM dish_ratings d JOIN order_ratings r ON r.id = d.order_rating_id
          WHERE r.branch_id = ? AND d.status = 'COUNTED'
          GROUP BY d.menu_item_id`,
      )
      .all(branchId);
  }

  summary(branchId: string, from: string, to: string) {
    const captains = this.db
      .prepare<
        [string, string, string],
        { captainId: string; name: string; ratings: number; average: number }
      >(
        `SELECT r.captain_id AS captainId, u.full_name AS name, count(*) AS ratings,
                round(avg(r.captain_stars), 1) AS average
           FROM order_ratings r JOIN users u ON u.id = r.captain_id
          WHERE r.branch_id = ? AND r.business_date BETWEEN ? AND ? AND r.captain_stars IS NOT NULL
          GROUP BY r.captain_id
          ORDER BY average DESC, ratings DESC, name`,
      )
      .all(branchId, from, to);
    const dishes = this.db
      .prepare<
        [string, string, string],
        {
          menuItemId: string;
          name: string;
          counted: number;
          average: number | null;
          pending: number;
          excluded: number;
        }
      >(
        `SELECT d.menu_item_id AS menuItemId, m.name,
                sum(d.status = 'COUNTED') AS counted,
                round(avg(CASE WHEN d.status = 'COUNTED' THEN d.stars END), 1) AS average,
                sum(d.status = 'PENDING') AS pending, sum(d.status = 'EXCLUDED') AS excluded
           FROM dish_ratings d
           JOIN order_ratings r ON r.id = d.order_rating_id
           JOIN menu_items m ON m.id = d.menu_item_id
          WHERE r.branch_id = ? AND r.business_date BETWEEN ? AND ?
          GROUP BY d.menu_item_id
          ORDER BY counted DESC, average DESC, m.name`,
      )
      .all(branchId, from, to);
    return { captains, dishes };
  }

  bestsellers(branchId: string): BestsellerEntry[] {
    return this.db
      .prepare<[string], { menuItemId: string; published: number }>(
        `SELECT menu_item_id AS menuItemId, published FROM bestsellers WHERE branch_id = ? ORDER BY position`,
      )
      .all(branchId)
      .map((r) => ({ menuItemId: r.menuItemId, published: r.published === 1 }));
  }

  replaceBestsellers(
    branchId: string,
    entries: readonly BestsellerEntry[],
    by: string | null,
    at: string,
  ): void {
    // A configuration list, replaced whole and deletable by design (the service audits it).
    // eslint-disable-next-line no-restricted-syntax
    this.db.prepare('DELETE FROM bestsellers WHERE branch_id = ?').run(branchId);
    const insert = this.db.prepare(
      `INSERT INTO bestsellers (branch_id, menu_item_id, position, published, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    entries.forEach((e, position) =>
      insert.run(branchId, e.menuItemId, position, e.published ? 1 : 0, at, by),
    );
  }
}
