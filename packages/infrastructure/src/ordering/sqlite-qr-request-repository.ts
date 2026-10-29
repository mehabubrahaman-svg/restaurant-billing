import type { QrRequestRecord, QrRequestRepository } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

type Row = Omit<QrRequestRecord, 'items'> & { itemsJson: string };
const COLUMNS = `r.id, r.branch_id AS branchId, r.table_id AS tableId, r.kind, r.status, r.items_json AS itemsJson,
                 r.guest_name AS guestName, r.covers, r.note, r.order_id AS orderId, r.handled_by AS handledBy,
                 r.handled_at AS handledAt, r.reject_reason AS rejectReason, r.client_key AS clientKey,
                 r.created_at AS createdAt, r.version`;
const toRecord = ({ itemsJson, ...r }: Row): QrRequestRecord => ({
  ...r,
  items: JSON.parse(itemsJson) as QrRequestRecord['items'],
});

export class SqliteQrRequestRepository implements QrRequestRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(id: string): QrRequestRecord | undefined {
    const r = this.db
      .prepare<[string], Row>(`SELECT ${COLUMNS} FROM qr_requests r WHERE r.id = ?`)
      .get(id);
    return r && toRecord(r);
  }

  byClientKey(tableId: string, clientKey: string): QrRequestRecord | undefined {
    const r = this.db
      .prepare<[string, string], Row>(
        `SELECT ${COLUMNS} FROM qr_requests r WHERE r.table_id = ? AND r.client_key = ?`,
      )
      .get(tableId, clientKey);
    return r && toRecord(r);
  }

  pending(branchId: string) {
    return this.db
      .prepare<[string], Row & { tableLabel: string }>(
        `SELECT ${COLUMNS}, t.label AS tableLabel
           FROM qr_requests r JOIN dining_tables t ON t.id = r.table_id
          WHERE r.branch_id = ? AND r.status = 'PENDING'
          ORDER BY r.created_at, r.id`,
      )
      .all(branchId)
      .map(({ tableLabel, ...r }) => ({ ...toRecord(r), tableLabel }));
  }

  pendingCount(tableId: string): number {
    return this.db
      .prepare<[string], number>(
        "SELECT count(*) FROM qr_requests WHERE table_id = ? AND status = 'PENDING'",
      )
      .pluck()
      .get(tableId)!;
  }

  insert(r: QrRequestRecord): void {
    this.db
      .prepare(
        `INSERT INTO qr_requests (id, branch_id, table_id, kind, status, items_json, guest_name, covers, note,
                                  order_id, handled_by, handled_at, reject_reason, client_key, created_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.tableId,
        r.kind,
        r.status,
        JSON.stringify(r.items),
        r.guestName,
        r.covers,
        r.note,
        r.orderId,
        r.handledBy,
        r.handledAt,
        r.rejectReason,
        r.clientKey,
        r.createdAt,
        r.version,
      );
  }

  update(r: QrRequestRecord): void {
    const result = this.db
      .prepare(
        `UPDATE qr_requests SET status = ?, order_id = ?, handled_by = ?, handled_at = ?, reject_reason = ?,
                version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.status,
        r.orderId,
        r.handledBy,
        r.handledAt,
        r.rejectReason,
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'QrRequest', r.id);
  }
}
