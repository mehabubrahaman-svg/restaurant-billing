import type { FloorAreaRecord, FloorRepository, TableRecord } from '@restroos/application';
import type { TableStatus } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

interface TableRow {
  id: string;
  branch_id: string;
  floor_area_id: string;
  label: string;
  seats: number;
  shape: TableRecord['shape'];
  pos_x: number;
  pos_y: number;
  status: TableStatus;
  current_order_id: string | null;
  qr_token: string | null;
  deleted_at: string | null;
  version: number;
}

const toTable = (r: TableRow): TableRecord => ({
  id: r.id,
  floorAreaId: r.floor_area_id,
  label: r.label,
  seats: r.seats,
  shape: r.shape,
  posX: r.pos_x,
  posY: r.pos_y,
  status: r.status,
  currentOrderId: r.current_order_id,
  qrToken: r.qr_token,
  isActive: r.deleted_at === null,
  version: r.version,
});

export class SqliteFloorRepository implements FloorRepository {
  constructor(private readonly db: SqliteDatabase) {}

  areas(branchId: string): FloorAreaRecord[] {
    return this.db
      .prepare<
        [string],
        { id: string; name: string; sort_order: number; deleted_at: string | null; version: number }
      >(
        'SELECT id, name, sort_order, deleted_at, version FROM floor_areas WHERE branch_id = ? ORDER BY sort_order, name',
      )
      .all(branchId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        sortOrder: r.sort_order,
        isActive: r.deleted_at === null,
        version: r.version,
      }));
  }

  area(branchId: string, id: string): FloorAreaRecord | undefined {
    return this.areas(branchId).find((a) => a.id === id);
  }

  insertArea(branchId: string, r: FloorAreaRecord, at: Date): void {
    this.db
      .prepare(
        'INSERT INTO floor_areas (id, branch_id, name, sort_order, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(r.id, branchId, r.name, r.sortOrder, at.toISOString(), at.toISOString(), r.version);
  }

  updateArea(branchId: string, r: FloorAreaRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE floor_areas SET name = ?, sort_order = ?, deleted_at = ?, updated_at = ?, version = ?
          WHERE id = ? AND branch_id = ? AND version = ?`,
      )
      .run(
        r.name,
        r.sortOrder,
        r.isActive ? null : at.toISOString(),
        at.toISOString(),
        r.version,
        r.id,
        branchId,
        r.version - 1,
      );
    assertVersionMatched(result, 'FloorArea', r.id);
  }

  tables(branchId: string): TableRecord[] {
    return this.db
      .prepare<[string], TableRow>('SELECT * FROM dining_tables WHERE branch_id = ? ORDER BY label')
      .all(branchId)
      .map(toTable);
  }

  table(branchId: string, id: string): TableRecord | undefined {
    const row = this.db
      .prepare<[string, string], TableRow>(
        'SELECT * FROM dining_tables WHERE branch_id = ? AND id = ?',
      )
      .get(branchId, id);
    return row && toTable(row);
  }

  tableIdByLabel(branchId: string, label: string): string | undefined {
    return this.db
      .prepare<[string, string], string>(
        'SELECT id FROM dining_tables WHERE branch_id = ? AND lower(label) = lower(?) AND deleted_at IS NULL',
      )
      .pluck()
      .get(branchId, label);
  }

  tableByQrToken(token: string): (TableRecord & { branchId: string }) | undefined {
    const row = this.db
      .prepare<[string], TableRow>(
        'SELECT * FROM dining_tables WHERE qr_token = ? AND deleted_at IS NULL',
      )
      .get(token);
    return row && { ...toTable(row), branchId: row.branch_id };
  }

  insertTable(branchId: string, r: TableRecord, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO dining_tables (id, branch_id, floor_area_id, label, seats, shape, pos_x, pos_y, status, qr_token,
                                    created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        branchId,
        r.floorAreaId,
        r.label,
        r.seats,
        r.shape,
        r.posX,
        r.posY,
        r.status,
        r.qrToken,
        at.toISOString(),
        at.toISOString(),
        r.version,
      );
  }

  updateTable(branchId: string, r: TableRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE dining_tables SET floor_area_id = ?, label = ?, seats = ?, shape = ?, pos_x = ?, pos_y = ?, status = ?,
                current_order_id = ?, qr_token = ?, deleted_at = ?, updated_at = ?, version = ?
          WHERE id = ? AND branch_id = ? AND version = ?`,
      )
      .run(
        r.floorAreaId,
        r.label,
        r.seats,
        r.shape,
        r.posX,
        r.posY,
        r.status,
        r.currentOrderId,
        r.qrToken,
        r.isActive ? null : at.toISOString(),
        at.toISOString(),
        r.version,
        r.id,
        branchId,
        r.version - 1,
      );
    assertVersionMatched(result, 'DiningTable', r.id);
  }
}
