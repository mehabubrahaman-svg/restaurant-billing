import type { MembershipTierRecord, MembershipTierRepository } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

type Row = Omit<MembershipTierRecord, 'isActive'> & { isActive: number };
const COLUMNS = `id, name, min_spend AS minSpend, min_visits AS minVisits,
                 points_multiplier_bp AS pointsMultiplierBp, discount_bp AS discountBp,
                 is_active AS isActive, version`;
const toRecord = (r: Row): MembershipTierRecord => ({ ...r, isActive: r.isActive === 1 });

export class SqliteMembershipTierRepository implements MembershipTierRepository {
  constructor(private readonly db: SqliteDatabase) {}

  all(): MembershipTierRecord[] {
    return this.db
      .prepare<[], Row>(
        `SELECT ${COLUMNS} FROM membership_tiers ORDER BY min_spend, min_visits, name`,
      )
      .all()
      .map(toRecord);
  }

  get(id: string): MembershipTierRecord | undefined {
    const r = this.db
      .prepare<[string], Row>(`SELECT ${COLUMNS} FROM membership_tiers WHERE id = ?`)
      .get(id);
    return r && toRecord(r);
  }

  byName(name: string): MembershipTierRecord | undefined {
    const r = this.db
      .prepare<[string], Row>(
        `SELECT ${COLUMNS} FROM membership_tiers WHERE name = ? COLLATE NOCASE`,
      )
      .get(name);
    return r && toRecord(r);
  }

  insert(r: MembershipTierRecord, actorId: string | null, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO membership_tiers (id, organization_id, name, min_spend, min_visits, points_multiplier_bp,
                                       discount_bp, is_active, created_at, created_by, updated_at, updated_by, version)
         VALUES (?, (SELECT id FROM organizations LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.name,
        r.minSpend,
        r.minVisits,
        r.pointsMultiplierBp,
        r.discountBp,
        r.isActive ? 1 : 0,
        at.toISOString(),
        actorId,
        at.toISOString(),
        actorId,
        r.version,
      );
  }

  update(r: MembershipTierRecord, actorId: string | null, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE membership_tiers SET name = ?, min_spend = ?, min_visits = ?, points_multiplier_bp = ?,
                discount_bp = ?, is_active = ?, updated_at = ?, updated_by = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.name,
        r.minSpend,
        r.minVisits,
        r.pointsMultiplierBp,
        r.discountBp,
        r.isActive ? 1 : 0,
        at.toISOString(),
        actorId,
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'MembershipTier', r.id);
  }
}
