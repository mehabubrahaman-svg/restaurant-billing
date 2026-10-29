import type { LoyaltyEntryRecord, LoyaltyKind, LoyaltyRepository } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

export class SqliteLoyaltyRepository implements LoyaltyRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(e: LoyaltyEntryRecord): void {
    this.db
      .prepare(
        `INSERT INTO loyalty_transactions (id, customer_id, branch_id, invoice_id, kind, points, note, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.id,
        e.customerId,
        e.branchId,
        e.invoiceId,
        e.kind,
        e.points,
        e.note,
        e.createdAt,
        e.createdBy,
      );
    // The cached balance moves with the ledger, in the same transaction.
    this.db
      .prepare('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?')
      .run(e.points, e.customerId);
  }

  entries(customerId: string, limit: number) {
    return this.db
      .prepare<
        [string, number],
        LoyaltyEntryRecord & { invoiceNo: string | null; createdByName: string | null }
      >(
        `SELECT l.id, l.customer_id AS customerId, l.branch_id AS branchId, l.invoice_id AS invoiceId, l.kind,
                l.points, l.note, l.created_at AS createdAt, l.created_by AS createdBy,
                i.invoice_no AS invoiceNo, u.full_name AS createdByName
           FROM loyalty_transactions l
           LEFT JOIN invoices i ON i.id = l.invoice_id
           LEFT JOIN users u ON u.id = l.created_by
          WHERE l.customer_id = ?
          ORDER BY l.created_at DESC, l.rowid DESC
          LIMIT ?`,
      )
      .all(customerId, limit);
  }

  netByKind(invoiceIds: readonly string[]) {
    if (invoiceIds.length === 0) return [];
    return this.db
      .prepare<string[], { customerId: string; kind: LoyaltyKind; points: number }>(
        `SELECT customer_id AS customerId, kind, sum(points) AS points
           FROM loyalty_transactions
          WHERE invoice_id IN (${invoiceIds.map(() => '?').join(', ')})
          GROUP BY customer_id, kind`,
      )
      .all(...invoiceIds);
  }
}
