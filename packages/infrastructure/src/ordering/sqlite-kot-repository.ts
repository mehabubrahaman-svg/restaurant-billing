import type { KotRepository } from '@restroos/application';
import { Kot, type KotLine, type KotState } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';
import { uuidv7Generator } from '../system/uuidv7-generator';

interface KotRow {
  id: string;
  branch_id: string;
  order_id: string;
  kitchen_station_id: string | null;
  kot_no: number;
  business_date: string;
  status: KotState['status'];
  priority: number;
  assigned_chef_id: string | null;
  fired_at: string;
  accepted_at: string | null;
  cooking_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  target_ready_at: string;
  created_by: string;
  version: number;
}

const date = (v: string | null) => (v === null ? null : new Date(v));
const iso = (v: Date | null) => v?.toISOString() ?? null;

export class SqliteKotRepository implements KotRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => Date,
  ) {}

  get(branchId: string, id: string): Kot | undefined {
    const row = this.db
      .prepare<[string, string], KotRow>('SELECT * FROM kots WHERE id = ? AND branch_id = ?')
      .get(id, branchId);
    return row && this.restore(row);
  }

  forOrder(orderId: string): Kot[] {
    return this.db
      .prepare<[string], KotRow>('SELECT * FROM kots WHERE order_id = ? ORDER BY kot_no')
      .all(orderId)
      .map((row) => this.restore(row));
  }

  insert(kot: Kot): void {
    const s = kot.state;
    this.db
      .prepare(
        `INSERT INTO kots (id, branch_id, order_id, kitchen_station_id, kot_no, business_date, status, priority,
                           assigned_chef_id, fired_at, target_ready_at, created_at, created_by, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        kot.id,
        s.branchId,
        s.orderId,
        s.kitchenStationId,
        s.kotNo,
        s.businessDate,
        s.status,
        s.priority,
        s.assignedChefId,
        s.firedAt.toISOString(),
        s.targetReadyAt.toISOString(),
        s.firedAt.toISOString(),
        s.createdBy,
        s.firedAt.toISOString(),
        kot.version,
      );
    this.insertEvent(kot.id, null, s.status, s.createdBy, s.firedAt);
    kot.markPersisted();
  }

  save(kot: Kot, actorId: string | null): void {
    const s = kot.state;
    const before = this.db
      .prepare<[string], KotState['status']>('SELECT status FROM kots WHERE id = ?')
      .pluck()
      .get(kot.id);
    const result = this.db
      .prepare(
        `UPDATE kots SET order_id = ?, status = ?, priority = ?, assigned_chef_id = ?, accepted_at = ?, cooking_at = ?,
                ready_at = ?, served_at = ?, updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        s.orderId,
        s.status,
        s.priority,
        s.assignedChefId,
        iso(s.acceptedAt),
        iso(s.cookingAt),
        iso(s.readyAt),
        iso(s.servedAt),
        this.now().toISOString(),
        kot.version,
        kot.id,
        kot.persistedVersion,
      );
    assertVersionMatched(result, 'Kot', kot.id);
    const writeLine = this.db.prepare(
      'UPDATE order_items SET status = ?, ready_at = ? WHERE id = ? AND kot_id = ?',
    );
    for (const change of kot.lineChanges()) {
      writeLine.run(change.status, iso(change.readyAt), change.id, kot.id);
    }
    if (before !== s.status)
      this.insertEvent(kot.id, before ?? null, s.status, actorId, this.now());
    kot.markPersisted();
  }

  nextKotNo(branchId: string, businessDate: string): number {
    return this.db
      .prepare<[string, string], number>(
        'SELECT coalesce(max(kot_no), 0) + 1 FROM kots WHERE branch_id = ? AND business_date = ?',
      )
      .pluck()
      .get(branchId, businessDate)!;
  }

  /** kot_status_events: the append-only status history used for kitchen timings. */
  private insertEvent(
    kotId: string,
    from: string | null,
    to: string,
    actorId: string | null,
    at: Date,
  ): void {
    this.db
      .prepare(
        `INSERT INTO kot_status_events (id, kot_id, from_status, to_status, actor_id, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(uuidv7Generator.next(), kotId, from, to, actorId, at.toISOString());
  }

  private restore(row: KotRow): Kot {
    const lines = this.db
      .prepare<[string], { id: string; status: KotLine['status']; ready_at: string | null }>(
        'SELECT id, status, ready_at FROM order_items WHERE kot_id = ? ORDER BY created_at, rowid',
      )
      .all(row.id)
      .map((l) => ({ id: l.id, status: l.status, readyAt: date(l.ready_at) }));
    return Kot.restore(row.id, row.version, {
      branchId: row.branch_id,
      orderId: row.order_id,
      kitchenStationId: row.kitchen_station_id,
      kotNo: row.kot_no,
      businessDate: row.business_date,
      status: row.status,
      priority: row.priority,
      assignedChefId: row.assigned_chef_id,
      firedAt: new Date(row.fired_at),
      acceptedAt: date(row.accepted_at),
      cookingAt: date(row.cooking_at),
      readyAt: date(row.ready_at),
      servedAt: date(row.served_at),
      targetReadyAt: new Date(row.target_ready_at),
      createdBy: row.created_by,
      lines,
    });
  }
}
