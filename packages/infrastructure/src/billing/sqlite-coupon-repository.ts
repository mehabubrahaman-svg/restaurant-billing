import type { CouponRecord, CouponRepository } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

type Coupon = CouponRecord & { version: number };
const COLUMNS = `id, code, kind, value, max_discount AS maxDiscount, min_bill AS minBill, valid_from AS validFrom,
                valid_to AS validTo, usage_limit AS usageLimit, used_count AS usedCount, is_active AS isActive, version`;

export class SqliteCouponRepository implements CouponRepository {
  constructor(private readonly db: SqliteDatabase) {}

  byCode(code: string): CouponRecord | undefined {
    const row = this.db
      .prepare<[string], Omit<CouponRecord, 'isActive'> & { isActive: number }>(
        `SELECT id, code, kind, value, max_discount AS maxDiscount, min_bill AS minBill, valid_from AS validFrom,
                valid_to AS validTo, usage_limit AS usageLimit, used_count AS usedCount, is_active AS isActive
           FROM coupons WHERE code = ? AND deleted_at IS NULL`,
      )
      .get(code);
    return row && { ...row, isActive: row.isActive === 1 };
  }

  all(): Coupon[] {
    return this.db
      .prepare<[], Omit<Coupon, 'isActive'> & { isActive: number }>(
        `SELECT ${COLUMNS} FROM coupons WHERE deleted_at IS NULL ORDER BY is_active DESC, code`,
      )
      .all()
      .map((r) => ({ ...r, isActive: r.isActive === 1 }));
  }

  get(id: string): Coupon | undefined {
    const r = this.db
      .prepare<[string], Omit<Coupon, 'isActive'> & { isActive: number }>(
        `SELECT ${COLUMNS} FROM coupons WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id);
    return r && { ...r, isActive: r.isActive === 1 };
  }

  insert(c: Coupon, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO coupons (id, organization_id, code, kind, value, max_discount, min_bill, valid_from, valid_to,
                              usage_limit, used_count, is_active, created_at, updated_at, version)
         VALUES (?, (SELECT id FROM organizations LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.code,
        c.kind,
        c.value,
        c.maxDiscount,
        c.minBill,
        c.validFrom,
        c.validTo,
        c.usageLimit,
        at.toISOString(),
        at.toISOString(),
        c.version,
      );
  }

  update(c: Coupon, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE coupons SET code = ?, kind = ?, value = ?, max_discount = ?, min_bill = ?, valid_from = ?, valid_to = ?,
                usage_limit = ?, is_active = ?, updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        c.code,
        c.kind,
        c.value,
        c.maxDiscount,
        c.minBill,
        c.validFrom,
        c.validTo,
        c.usageLimit,
        c.isActive ? 1 : 0,
        at.toISOString(),
        c.version,
        c.id,
        c.version - 1,
      );
    assertVersionMatched(result, 'Coupon', c.id);
  }

  markUsed(id: string, at: Date): void {
    this.db
      .prepare('UPDATE coupons SET used_count = used_count + 1, updated_at = ? WHERE id = ?')
      .run(at.toISOString(), id);
  }
}
