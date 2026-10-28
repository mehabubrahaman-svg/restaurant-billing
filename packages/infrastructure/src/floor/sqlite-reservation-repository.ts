import type { ReservationRecord, ReservationRepository } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

// reserved_for is always written by toISOString(), so text order is time order.
const SELECT = `SELECT r.id, r.dining_table_id AS tableId, t.label AS tableLabel, r.customer_id AS customerId,
                       r.guest_name AS guestName, r.guest_phone AS guestPhone, r.party_size AS partySize,
                       r.reserved_for AS reservedFor, r.status, r.notes, r.created_at AS createdAt, r.version
                  FROM reservations r LEFT JOIN dining_tables t ON t.id = r.dining_table_id
                 WHERE r.branch_id = ? AND r.deleted_at IS NULL`;

export class SqliteReservationRepository implements ReservationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(branchId: string, id: string) {
    return this.db
      .prepare<[string, string], ReservationRecord>(`${SELECT} AND r.id = ?`)
      .get(branchId, id);
  }

  between(branchId: string, from: string, to: string) {
    return this.db
      .prepare<[string, string, string], ReservationRecord>(
        `${SELECT} AND r.reserved_for >= ? AND r.reserved_for <= ? ORDER BY r.reserved_for, r.guest_name`,
      )
      .all(branchId, from, to);
  }

  bookedOnTable(branchId: string, tableId: string, from: string, to: string) {
    return this.db
      .prepare<[string, string, string, string], ReservationRecord>(
        `${SELECT} AND r.dining_table_id = ? AND r.status = 'BOOKED'
                   AND r.reserved_for >= ? AND r.reserved_for <= ? ORDER BY r.reserved_for`,
      )
      .all(branchId, tableId, from, to);
  }

  insert(branchId: string, r: ReservationRecord, actorId: string | null, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO reservations (id, branch_id, dining_table_id, customer_id, guest_name, guest_phone, party_size,
                                   reserved_for, status, notes, created_at, created_by, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        branchId,
        r.tableId,
        r.customerId,
        r.guestName,
        r.guestPhone,
        r.partySize,
        r.reservedFor,
        r.status,
        r.notes,
        r.createdAt,
        actorId,
        at.toISOString(),
        r.version,
      );
  }

  update(branchId: string, r: ReservationRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE reservations SET dining_table_id = ?, customer_id = ?, guest_name = ?, guest_phone = ?, party_size = ?,
                reserved_for = ?, status = ?, notes = ?, updated_at = ?, version = ?
          WHERE id = ? AND branch_id = ? AND version = ?`,
      )
      .run(
        r.tableId,
        r.customerId,
        r.guestName,
        r.guestPhone,
        r.partySize,
        r.reservedFor,
        r.status,
        r.notes,
        at.toISOString(),
        r.version,
        r.id,
        branchId,
        r.version - 1,
      );
    assertVersionMatched(result, 'Reservation', r.id);
  }
}
