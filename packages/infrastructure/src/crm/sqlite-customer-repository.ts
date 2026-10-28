import type { CustomerRecord, CustomerRepository } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

type Row = Omit<CustomerRecord, 'marketingOptIn'> & { marketingOptIn: number };
const COLUMNS = `id, phone, name, email, tax_id AS taxId, preferred_locale AS preferredLocale, visit_count AS visitCount,
                 lifetime_value AS lifetimeValue, last_visit_at AS lastVisitAt, marketing_opt_in AS marketingOptIn, version`;
const toRecord = (r: Row): CustomerRecord => ({ ...r, marketingOptIn: r.marketingOptIn === 1 });

export class SqliteCustomerRepository implements CustomerRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(id: string) {
    const r = this.db
      .prepare<[string], Row>(
        `SELECT ${COLUMNS} FROM customers WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id);
    return r && toRecord(r);
  }

  byPhone(phone: string) {
    const r = this.db
      .prepare<[string], Row>(
        `SELECT ${COLUMNS} FROM customers WHERE phone = ? AND deleted_at IS NULL`,
      )
      .get(phone);
    return r && toRecord(r);
  }

  search(query: string, limit: number) {
    const digits = query.replaceAll(/\D/g, '');
    const order = 'ORDER BY last_visit_at IS NULL, last_visit_at DESC, name LIMIT ?';
    const rows =
      digits.length >= 3
        ? this.db
            .prepare<[string, number], Row>(
              `SELECT ${COLUMNS} FROM customers WHERE deleted_at IS NULL AND phone LIKE ? ${order}`,
            )
            .all(`%${digits}%`, limit)
        : this.db
            .prepare<[string, number], Row>(
              `SELECT ${COLUMNS} FROM customers WHERE deleted_at IS NULL AND name LIKE ? COLLATE NOCASE ${order}`,
            )
            .all(`%${query}%`, limit);
    return rows.map(toRecord);
  }

  insert(r: CustomerRecord, actorId: string | null, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO customers (id, organization_id, phone, name, email, tax_id, preferred_locale, marketing_opt_in,
                                created_at, created_by, updated_at, version)
         VALUES (?, (SELECT id FROM organizations LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.phone,
        r.name,
        r.email,
        r.taxId,
        r.preferredLocale,
        r.marketingOptIn ? 1 : 0,
        at.toISOString(),
        actorId,
        at.toISOString(),
        r.version,
      );
  }

  update(r: CustomerRecord, actorId: string | null, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE customers SET phone = ?, name = ?, email = ?, tax_id = ?, preferred_locale = ?, marketing_opt_in = ?,
                updated_at = ?, updated_by = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.phone,
        r.name,
        r.email,
        r.taxId,
        r.preferredLocale,
        r.marketingOptIn ? 1 : 0,
        at.toISOString(),
        actorId,
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'Customer', r.id);
  }

  recordVisit(id: string, amount: number, at: Date): void {
    this.db
      .prepare(
        'UPDATE customers SET visit_count = visit_count + 1, lifetime_value = lifetime_value + ?, last_visit_at = ? WHERE id = ?',
      )
      .run(amount, at.toISOString(), id);
  }

  addLifetimeValue(id: string, amount: number): void {
    this.db
      .prepare('UPDATE customers SET lifetime_value = lifetime_value + ? WHERE id = ?')
      .run(amount, id);
  }

  recentInvoices(id: string, limit: number) {
    return this.db
      .prepare<
        [string, number],
        { id: string; invoiceNo: string; businessDate: string; grandTotal: number; status: string }
      >(
        `SELECT id, invoice_no AS invoiceNo, business_date AS businessDate, grand_total AS grandTotal, status
           FROM invoices WHERE customer_id = ? AND kind = 'INVOICE' ORDER BY created_at DESC LIMIT ?`,
      )
      .all(id, limit);
  }

  favourites(id: string, limit: number) {
    return this.db
      .prepare<[string, number], { name: string; quantity: number }>(
        `SELECT l.description AS name, sum(l.quantity) AS quantity
           FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
          WHERE i.customer_id = ? AND i.kind = 'INVOICE' AND i.status NOT IN ('CANCELLED') AND l.quantity > 0
          GROUP BY l.description ORDER BY quantity DESC, name LIMIT ?`,
      )
      .all(id, limit);
  }
}
