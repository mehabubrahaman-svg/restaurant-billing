import type {
  AccountingRepository,
  AccountRecord,
  ExpenseRecord,
  GrnPosting,
  InvoicePosting,
  JournalSourceType,
  NewJournalEntry,
  PaymentPosting,
  PostedEntry,
  PostingSources,
  StockMovementPosting,
  SystemAccount,
  VendorPaymentPosting,
} from '@restroos/application';
import type { JournalLine } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { nextDocumentNumber } from '../db/document-sequences';
import { assertVersionMatched } from '../db/optimistic';
import { uuidv7Generator } from '../system/uuidv7-generator';

const ORG = '(SELECT id FROM organizations ORDER BY created_at LIMIT 1)';
const ACCOUNT_COLUMNS = `id, code, name, type, parent_id AS parentId, system_tag AS systemTag, is_active AS isActive, version`;
type AccountRow = Omit<AccountRecord, 'isActive'> & { isActive: number };
const toAccount = (r: AccountRow): AccountRecord => ({ ...r, isActive: r.isActive === 1 });

export class SqliteAccountingRepository implements AccountingRepository {
  constructor(private readonly db: SqliteDatabase) {}

  accounts(): AccountRecord[] {
    return this.db
      .prepare<[], AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY code`)
      .all()
      .map(toAccount);
  }

  account(id: string): AccountRecord | undefined {
    const r = this.db
      .prepare<[string], AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`)
      .get(id);
    return r && toAccount(r);
  }

  accountByCode(code: string): AccountRecord | undefined {
    const r = this.db
      .prepare<[string], AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE code = ?`)
      .get(code);
    return r && toAccount(r);
  }

  accountByTag(tag: SystemAccount): AccountRecord | undefined {
    const r = this.db
      .prepare<[string], AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE system_tag = ? AND organization_id = ${ORG}`,
      )
      .get(tag);
    return r && toAccount(r);
  }

  insertAccount(r: AccountRecord, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO accounts (id, organization_id, code, name, type, parent_id, system_tag, is_active,
                               created_at, updated_at, version)
         VALUES (?, ${ORG}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.code,
        r.name,
        r.type,
        r.parentId,
        r.systemTag,
        r.isActive ? 1 : 0,
        at.toISOString(),
        at.toISOString(),
        r.version,
      );
  }

  updateAccount(r: AccountRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE accounts SET name = ?, type = ?, parent_id = ?, is_active = ?, updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.name,
        r.type,
        r.parentId,
        r.isActive ? 1 : 0,
        at.toISOString(),
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'Account', r.id);
  }

  hasPostings(accountId: string): boolean {
    return (
      this.db
        .prepare<[string], number>(
          'SELECT EXISTS (SELECT 1 FROM journal_lines WHERE account_id = ?)',
        )
        .pluck()
        .get(accountId) === 1
    );
  }

  insertEntry(e: NewJournalEntry, lines: readonly JournalLine[], at: Date): void {
    this.db
      .prepare(
        `INSERT INTO journal_entries (id, branch_id, entry_no, entry_date, source_type, source_id, narration,
                                      reversal_of_id, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.id,
        e.branchId,
        e.entryNo,
        e.entryDate,
        e.sourceType,
        e.sourceId,
        e.narration,
        e.reversalOfId,
        at.toISOString(),
        e.createdBy,
      );
    const insert = this.db.prepare(
      `INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, party_type, party_id, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of lines)
      insert.run(
        uuidv7Generator.next(),
        e.id,
        l.accountId,
        l.debit,
        l.credit,
        l.partyType,
        l.partyId,
        l.memo,
      );
    // The schema's own guard: nothing unbalanced is committed.
    const unbalanced = this.db
      .prepare<[string], number>('SELECT count(*) FROM v_unbalanced_journal_entries WHERE id = ?')
      .pluck()
      .get(e.id);
    if (unbalanced !== 0) throw new Error(`journal entry ${e.id} does not balance`);
  }

  entry(branchId: string, id: string): PostedEntry | undefined {
    return this.loadEntry(
      this.db
        .prepare<[string, string], Omit<PostedEntry, 'lines'>>(
          `SELECT id, branch_id AS branchId, entry_date AS entryDate, source_type AS sourceType, source_id AS sourceId,
                  reversal_of_id AS reversalOfId
             FROM journal_entries WHERE branch_id = ? AND id = ?`,
        )
        .get(branchId, id),
    );
  }

  originalEntry(sourceType: JournalSourceType, sourceId: string): PostedEntry | undefined {
    return this.loadEntry(
      this.db
        .prepare<[string, string], Omit<PostedEntry, 'lines'>>(
          `SELECT id, branch_id AS branchId, entry_date AS entryDate, source_type AS sourceType, source_id AS sourceId,
                  reversal_of_id AS reversalOfId
             FROM journal_entries WHERE source_type = ? AND source_id = ? AND reversal_of_id IS NULL`,
        )
        .get(sourceType, sourceId),
    );
  }

  private loadEntry(head: Omit<PostedEntry, 'lines'> | undefined): PostedEntry | undefined {
    if (!head) return undefined;
    const lines = this.db
      .prepare<[string], JournalLine>(
        `SELECT account_id AS accountId, debit, credit, party_type AS partyType, party_id AS partyId, memo
           FROM journal_lines WHERE journal_entry_id = ? ORDER BY rowid`,
      )
      .all(head.id);
    return { ...head, lines };
  }

  reversalOf(entryId: string): string | undefined {
    return this.db
      .prepare<[string], string>('SELECT id FROM journal_entries WHERE reversal_of_id = ?')
      .pluck()
      .get(entryId);
  }

  nextEntryNo(branchId: string, fiscalYear: string, branchCode: string): string {
    return nextDocumentNumber(
      this.db,
      branchId,
      'JV',
      fiscalYear,
      `${branchCode}/JV/${fiscalYear}/`,
    );
  }

  insertExpense(r: ExpenseRecord, actorId: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO expenses (id, branch_id, expense_account_id, paid_from_account_id, amount, tax_amount,
                               description, reference, expense_date, created_at, created_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.expenseAccountId,
        r.paidFromAccountId,
        r.amount,
        r.taxAmount,
        r.description,
        r.reference,
        r.expenseDate,
        at.toISOString(),
        actorId,
        r.version,
      );
  }

  expense(branchId: string, id: string): ExpenseRecord | undefined {
    const r = this.db
      .prepare<[string, string], Omit<ExpenseRecord, 'isCancelled'> & { isCancelled: number }>(
        `SELECT id, branch_id AS branchId, expense_account_id AS expenseAccountId,
                paid_from_account_id AS paidFromAccountId, amount, tax_amount AS taxAmount, description, reference,
                expense_date AS expenseDate, (deleted_at IS NOT NULL) AS isCancelled, version
           FROM expenses WHERE branch_id = ? AND id = ?`,
      )
      .get(branchId, id);
    return r && { ...r, isCancelled: r.isCancelled === 1 };
  }

  cancelExpense(
    id: string,
    expectedVersion: number,
    reason: string,
    actorId: string | null,
    at: Date,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE expenses SET deleted_at = ?, deleted_by = ?, cancel_reason = ?, version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      )
      .run(at.toISOString(), actorId, reason, id, expectedVersion);
    assertVersionMatched(result, 'Expense', id);
  }
}

/** Bills, payments, GRNs, vendor payments and stock movements, as the automatic journals read them. */
export class SqlitePostingSources implements PostingSources {
  constructor(private readonly db: SqliteDatabase) {}

  invoice(id: string): InvoicePosting | undefined {
    const head = this.db
      .prepare<[string], Omit<InvoicePosting, 'sales' | 'taxes'>>(
        `SELECT id, branch_id AS branchId, invoice_no AS invoiceNo, kind, business_date AS businessDate,
                customer_id AS customerId, grand_total AS grandTotal, charges_total AS chargesTotal,
                round_off AS roundOff
           FROM invoices WHERE id = ?`,
      )
      .get(id);
    if (!head) return undefined;
    const sales = this.db
      .prepare<[string], { liquor: number; taxable: number }>(
        `SELECT coalesce(tg.tax_type = 'VAT', 0) AS liquor, sum(l.taxable_value) AS taxable
           FROM invoice_lines l LEFT JOIN tax_groups tg ON tg.id = l.tax_group_id
          WHERE l.invoice_id = ? GROUP BY 1 ORDER BY 1`,
      )
      .all(id)
      .map((s) => ({ liquor: s.liquor === 1, taxable: s.taxable }));
    const taxes = this.db
      .prepare<[string], InvoicePosting['taxes'][number]>(
        `SELECT tax_code AS code, sum(tax_amount) AS amount FROM invoice_taxes
          WHERE invoice_id = ? GROUP BY tax_code ORDER BY min(rowid)`,
      )
      .all(id);
    return { ...head, sales, taxes };
  }

  payments(invoiceId: string): PaymentPosting[] {
    return this.db
      .prepare<[string], PaymentPosting>(
        `SELECT p.id, p.branch_id AS branchId, i.invoice_no AS invoiceNo, p.method, p.amount,
                p.business_date AS businessDate, i.customer_id AS customerId
           FROM payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE p.invoice_id = ? ORDER BY p.rowid`,
      )
      .all(invoiceId);
  }

  grn(id: string): GrnPosting | undefined {
    return this.db
      .prepare<[string], GrnPosting>(
        `SELECT id, branch_id AS branchId, grn_no AS grnNo, vendor_id AS vendorId, vendor_invoice_no AS vendorInvoiceNo,
                business_date AS businessDate, subtotal, tax_total AS taxTotal, grand_total AS grandTotal,
                input_tax_kind AS inputTaxKind
           FROM grns WHERE id = ? AND status = 'POSTED'`,
      )
      .get(id);
  }

  vendorPayment(id: string): VendorPaymentPosting | undefined {
    return this.db
      .prepare<[string], VendorPaymentPosting>(
        `SELECT p.id, p.branch_id AS branchId, p.vendor_id AS vendorId, v.name AS vendorName, p.method, p.amount,
                p.paid_on AS paidOn
           FROM vendor_payments p JOIN vendors v ON v.id = p.vendor_id WHERE p.id = ?`,
      )
      .get(id);
  }

  stockMovementsAfter(seq: number, limit: number): StockMovementPosting[] {
    return this.db
      .prepare<[number, number], StockMovementPosting>(
        `SELECT rowid AS seq, id, branch_id AS branchId, business_date AS businessDate, movement_type AS type,
                reference_type AS referenceType, qty_milli * unit_cost_per_base AS rawValue
           FROM stock_movements WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      )
      .all(seq, limit);
  }
}
