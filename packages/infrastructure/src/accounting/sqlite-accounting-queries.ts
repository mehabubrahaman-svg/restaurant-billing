import type {
  AccountingQueries,
  AccountView,
  BalanceSheetView,
  CashFlowView,
  ExpenseView,
  GstSummaryView,
  JournalEntryView,
  JournalSourceType,
  LedgerEntryView,
  LedgerView,
  PartyLedgerView,
  PartyType,
  ProfitAndLossView,
  TrialBalanceView,
} from '@restroos/application';
import { normalBalance, shareBp, type AccountType } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';

type AccountRow = Omit<AccountView, 'isActive' | 'balance'> & {
  isActive: number;
  debit: number;
  credit: number;
};

/** The number of the document behind an entry. */
const SOURCE_NO = `CASE je.source_type
    WHEN 'INVOICE' THEN (SELECT invoice_no FROM invoices WHERE id = je.source_id)
    WHEN 'CREDIT_NOTE' THEN (SELECT invoice_no FROM invoices WHERE id = je.source_id)
    WHEN 'PAYMENT' THEN (SELECT i.invoice_no FROM payments p JOIN invoices i ON i.id = p.invoice_id
                          WHERE p.id = je.source_id)
    WHEN 'GRN' THEN (SELECT grn_no FROM grns WHERE id = je.source_id)
    WHEN 'VENDOR_PAYMENT' THEN (SELECT reference FROM vendor_payments WHERE id = je.source_id)
    WHEN 'EXPENSE' THEN (SELECT reference FROM expenses WHERE id = je.source_id)
  END`;

const PARTY_NAME = `CASE jl.party_type
    WHEN 'CUSTOMER' THEN (SELECT coalesce(name, phone) FROM customers WHERE id = jl.party_id)
    WHEN 'VENDOR' THEN (SELECT name FROM vendors WHERE id = jl.party_id)
  END`;

/** The other accounts of an entry, for "against" in a ledger. */
const AGAINST = `(SELECT group_concat(DISTINCT a2.name) FROM journal_lines o JOIN accounts a2 ON a2.id = o.account_id
                   WHERE o.journal_entry_id = je.id AND o.account_id <> jl.account_id)`;

const COST_OF_SALES = new Set(['COGS', 'WASTAGE', 'STOCK_ADJUSTMENT']);
const CASH_TAGS = new Set(['CASH', 'BANK', 'CARD_UPI_CLEARING']);

/** Where money in or out of the till and bank came from, by the entry's source. */
function cashCategory(source: JournalSourceType): string {
  switch (source) {
    case 'INVOICE':
    case 'CREDIT_NOTE':
    case 'PAYMENT':
      return 'CUSTOMERS';
    case 'GRN':
    case 'VENDOR_PAYMENT':
      return 'VENDORS';
    case 'EXPENSE':
      return 'EXPENSES';
    case 'STOCK':
      return 'STOCK';
    default:
      return 'OTHER';
  }
}

export class SqliteAccountingQueries implements AccountingQueries {
  constructor(private readonly db: SqliteDatabase) {}

  /** Every account with its debits and credits in a branch over a date range (from null: since the start). */
  private totals(branchId: string, from: string | null, to: string): AccountRow[] {
    return this.db
      .prepare<{ branchId: string; from: string | null; to: string }, AccountRow>(
        `SELECT a.id, a.code, a.name, a.type, a.parent_id AS parentId, a.system_tag AS systemTag,
                a.is_active AS isActive, a.version, coalesce(t.debit, 0) AS debit, coalesce(t.credit, 0) AS credit
           FROM accounts a
           LEFT JOIN (SELECT jl.account_id, sum(jl.debit) AS debit, sum(jl.credit) AS credit
                        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
                       WHERE je.branch_id = @branchId AND je.entry_date <= @to
                         AND (@from IS NULL OR je.entry_date >= @from)
                       GROUP BY jl.account_id) t ON t.account_id = a.id
          WHERE a.organization_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
          ORDER BY a.code`,
      )
      .all({ branchId, from, to });
  }

  private toView(r: AccountRow): AccountView {
    const { debit, credit, isActive, ...rest } = r;
    return { ...rest, isActive: isActive === 1, balance: normalBalance(r.type, debit, credit) };
  }

  accounts(branchId: string): AccountView[] {
    return this.totals(branchId, null, '9999-12-31').map((r) => this.toView(r));
  }

  account(branchId: string, id: string): AccountView | undefined {
    return this.accounts(branchId).find((a) => a.id === id);
  }

  journal(
    branchId: string,
    filter: {
      from?: string | undefined;
      to?: string | undefined;
      sourceType?: JournalSourceType | undefined;
      accountId?: string | undefined;
      before?: string | undefined;
      limit: number;
    },
  ): JournalEntryView[] {
    return this.entries(
      `je.branch_id = @branchId AND (@from IS NULL OR je.entry_date >= @from) AND (@to IS NULL OR je.entry_date <= @to)
       AND (@type IS NULL OR je.source_type = @type)
       AND (@accountId IS NULL OR EXISTS (SELECT 1 FROM journal_lines x
                                           WHERE x.journal_entry_id = je.id AND x.account_id = @accountId))
       AND (@before IS NULL OR je.id < @before)
       ORDER BY je.id DESC LIMIT @limit`,
      {
        branchId,
        from: filter.from ?? null,
        to: filter.to ?? null,
        type: filter.sourceType ?? null,
        accountId: filter.accountId ?? null,
        before: filter.before ?? null,
        limit: filter.limit,
      },
    );
  }

  entry(branchId: string, id: string): JournalEntryView | undefined {
    return this.entries('je.branch_id = @branchId AND je.id = @id', { branchId, id })[0];
  }

  private entries(
    where: string,
    params: Record<string, string | number | null>,
  ): JournalEntryView[] {
    const heads = this.db
      .prepare<Record<string, string | number | null>, Omit<JournalEntryView, 'lines' | 'total'>>(
        `SELECT je.id, je.entry_no AS entryNo, je.entry_date AS entryDate, je.source_type AS sourceType,
                je.source_id AS sourceId, ${SOURCE_NO} AS sourceNo, je.narration, je.reversal_of_id AS reversalOfId,
                (SELECT r.id FROM journal_entries r WHERE r.reversal_of_id = je.id) AS reversedById,
                je.created_at AS createdAt, u.full_name AS createdByName
           FROM journal_entries je LEFT JOIN users u ON u.id = je.created_by
          WHERE ${where}`,
      )
      .all(params);
    const lines = this.db.prepare<[string], JournalEntryView['lines'][number]>(
      `SELECT jl.account_id AS accountId, a.code AS accountCode, a.name AS accountName, jl.debit, jl.credit,
              jl.party_type AS partyType, jl.party_id AS partyId, ${PARTY_NAME} AS partyName, jl.memo
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.journal_entry_id = ? ORDER BY jl.rowid`,
    );
    return heads.map((h) => {
      const l = lines.all(h.id);
      return { ...h, lines: l, total: l.reduce((s, x) => s + x.debit, 0) };
    });
  }

  expenses(
    branchId: string,
    filter: { from?: string | undefined; to?: string | undefined },
  ): ExpenseView[] {
    return this.expenseRows(
      'AND (@from IS NULL OR e.expense_date >= @from) AND (@to IS NULL OR e.expense_date <= @to)',
      {
        branchId,
        from: filter.from ?? null,
        to: filter.to ?? null,
        id: null,
      },
    );
  }

  expense(branchId: string, id: string): ExpenseView | undefined {
    return this.expenseRows('AND e.id = @id', { branchId, from: null, to: null, id })[0];
  }

  private expenseRows(where: string, params: Record<string, string | null>): ExpenseView[] {
    return this.db
      .prepare<Record<string, string | null>, ExpenseView>(
        `SELECT e.id, e.expense_account_id AS expenseAccountId, ea.name AS expenseAccountName,
                e.paid_from_account_id AS paidFromAccountId, pa.name AS paidFromAccountName, e.amount,
                e.tax_amount AS taxAmount, e.description, e.reference, e.expense_date AS expenseDate,
                CASE WHEN e.deleted_at IS NULL THEN 'POSTED' ELSE 'CANCELLED' END AS status,
                e.cancel_reason AS cancelReason,
                (SELECT je.id FROM journal_entries je WHERE je.source_type = 'EXPENSE' AND je.source_id = e.id
                    AND je.reversal_of_id IS NULL) AS journalEntryId,
                e.created_at AS createdAt, u.full_name AS createdByName, e.version
           FROM expenses e
           JOIN accounts ea ON ea.id = e.expense_account_id
           JOIN accounts pa ON pa.id = e.paid_from_account_id
           LEFT JOIN users u ON u.id = e.created_by
          WHERE e.branch_id = @branchId ${where}
          ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 500`,
      )
      .all(params);
  }

  ledger(branchId: string, accountId: string, from: string, to: string): LedgerView | undefined {
    const account = this.account(branchId, accountId);
    if (!account) return undefined;
    const before = this.totals(branchId, null, previousDay(from)).find((a) => a.id === accountId)!;
    const openingBalance = normalBalance(account.type, before.debit, before.credit);
    const rows = this.ledgerRows('jl.account_id = @key', { branchId, key: accountId, from, to });
    const entries = running(rows, openingBalance, (r) =>
      normalBalance(account.type, r.debit, r.credit),
    );
    return {
      account,
      from,
      to,
      openingBalance,
      entries,
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0),
      closingBalance: entries.at(-1)?.balance ?? openingBalance,
    };
  }

  partyLedger(
    branchId: string,
    partyType: PartyType,
    partyId: string,
    from: string,
    to: string,
  ): PartyLedgerView | undefined {
    const partyName = this.db
      .prepare<[string], string>(
        partyType === 'CUSTOMER'
          ? 'SELECT coalesce(name, phone) FROM customers WHERE id = ?'
          : partyType === 'VENDOR'
            ? 'SELECT name FROM vendors WHERE id = ?'
            : 'SELECT full_name FROM users WHERE id = ?',
      )
      .pluck()
      .get(partyId);
    if (partyName === undefined) return undefined;
    // What a customer owes us is a debit balance; what we owe a vendor or employee, a credit one.
    const owed = (debit: number, credit: number) =>
      partyType === 'CUSTOMER' ? debit - credit : credit - debit;
    const opening = this.db
      .prepare<Record<string, string>, { debit: number; credit: number }>(
        `SELECT coalesce(sum(jl.debit), 0) AS debit, coalesce(sum(jl.credit), 0) AS credit
           FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
          WHERE je.branch_id = @branchId AND jl.party_type = @type AND jl.party_id = @id AND je.entry_date < @from`,
      )
      .get({ branchId, type: partyType, id: partyId, from })!;
    const openingBalance = owed(opening.debit, opening.credit);
    const rows = this.ledgerRows('jl.party_type = @type AND jl.party_id = @key', {
      branchId,
      type: partyType,
      key: partyId,
      from,
      to,
    });
    const entries = running(rows, openingBalance, (r) => owed(r.debit, r.credit));
    return {
      partyType,
      partyId,
      partyName,
      from,
      to,
      openingBalance,
      entries,
      closingBalance: entries.at(-1)?.balance ?? openingBalance,
    };
  }

  private ledgerRows(
    where: string,
    params: Record<string, string>,
  ): Omit<LedgerEntryView, 'balance'>[] {
    return this.db
      .prepare<Record<string, string>, Omit<LedgerEntryView, 'balance'>>(
        `SELECT je.id AS journalEntryId, je.entry_no AS entryNo, je.entry_date AS date, je.source_type AS sourceType,
                ${SOURCE_NO} AS sourceNo, coalesce(jl.memo, je.narration) AS narration,
                coalesce(${AGAINST}, '') AS against, jl.debit, jl.credit
           FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
          WHERE je.branch_id = @branchId AND ${where} AND je.entry_date BETWEEN @from AND @to
          ORDER BY je.entry_date, je.created_at, je.id, jl.rowid`,
      )
      .all(params)
      .map((r) => ({ ...r, against: r.against.split(',').join(', ') }));
  }

  trialBalance(branchId: string, asOf: string): TrialBalanceView {
    const rows = this.totals(branchId, null, asOf)
      .filter((a) => a.debit !== a.credit)
      .map((a) => ({
        accountId: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        debit: Math.max(0, a.debit - a.credit),
        credit: Math.max(0, a.credit - a.debit),
      }));
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    return { asOf, rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
  }

  profitAndLoss(branchId: string, from: string, to: string): ProfitAndLossView {
    const accounts = this.totals(branchId, from, to);
    const pick = (keep: (a: AccountRow) => boolean) =>
      amounts(accounts.filter(keep), (a) => normalBalance(a.type, a.debit, a.credit));
    const income = pick((a) => a.type === 'INCOME');
    const costOfSales = pick((a) => a.type === 'EXPENSE' && COST_OF_SALES.has(a.systemTag ?? ''));
    const expenses = pick((a) => a.type === 'EXPENSE' && !COST_OF_SALES.has(a.systemTag ?? ''));
    const totalIncome = sum(income);
    const totalCostOfSales = sum(costOfSales);
    const grossProfit = totalIncome - totalCostOfSales;
    const totalExpenses = sum(expenses);
    return {
      from,
      to,
      income,
      totalIncome,
      costOfSales,
      totalCostOfSales,
      grossProfit,
      grossMarginBp: totalIncome > 0 ? shareBp(grossProfit, totalIncome) : null,
      expenses,
      totalExpenses,
      netProfit: grossProfit - totalExpenses,
    };
  }

  balanceSheet(branchId: string, asOf: string): BalanceSheetView {
    const accounts = this.totals(branchId, null, asOf);
    const of = (type: AccountType) =>
      amounts(
        accounts.filter((a) => a.type === type),
        (a) => normalBalance(a.type, a.debit, a.credit),
      );
    const assets = of('ASSET');
    const liabilities = of('LIABILITY');
    const equity = of('EQUITY');
    const profitToDate = sum(of('INCOME')) - sum(of('EXPENSE'));
    const totalAssets = sum(assets);
    const totalLiabilities = sum(liabilities);
    const totalEquity = sum(equity) + profitToDate;
    return {
      asOf,
      assets,
      totalAssets,
      liabilities,
      totalLiabilities,
      equity,
      profitToDate,
      totalEquity,
      balanced: totalAssets === totalLiabilities + totalEquity,
    };
  }

  cashFlow(branchId: string, from: string, to: string): CashFlowView {
    const isCash = (a: { systemTag: string | null }) => CASH_TAGS.has(a.systemTag ?? '');
    const opening = this.totals(branchId, null, previousDay(from)).filter(isCash);
    const openingCash = opening.reduce((s, a) => s + a.debit - a.credit, 0);
    const moves = this.db
      .prepare<
        { branchId: string; from: string; to: string },
        { sourceType: JournalSourceType; delta: number }
      >(
        `SELECT je.source_type AS sourceType, sum(jl.debit - jl.credit) AS delta
           FROM journal_lines jl
           JOIN journal_entries je ON je.id = jl.journal_entry_id
           JOIN accounts a ON a.id = jl.account_id
          WHERE je.branch_id = @branchId AND je.entry_date BETWEEN @from AND @to
            AND a.system_tag IN ('CASH','BANK','CARD_UPI_CLEARING')
          GROUP BY je.id`,
      )
      .all({ branchId, from, to });
    const inflows = new Map<string, number>();
    const outflows = new Map<string, number>();
    for (const m of moves) {
      if (m.delta === 0) continue;
      const into = m.delta > 0 ? inflows : outflows;
      const category = cashCategory(m.sourceType);
      into.set(category, (into.get(category) ?? 0) + Math.abs(m.delta));
    }
    const netChange = moves.reduce((s, m) => s + m.delta, 0);
    const toList = (map: Map<string, number>) =>
      [...map].map(([category, amount]) => ({ category, amount }));
    const closing = this.totals(branchId, null, to).filter(isCash);
    return {
      from,
      to,
      openingCash,
      inflows: toList(inflows),
      outflows: toList(outflows),
      netChange,
      closingCash: openingCash + netChange,
      accounts: closing.map((a) => ({
        accountId: a.id,
        code: a.code,
        name: a.name,
        amount: a.debit - a.credit,
      })),
    };
  }

  gstSummary(branchId: string, from: string, to: string): GstSummaryView {
    type Row = {
      invoiceId: string;
      sign: number;
      supplyType: 'B2B' | 'B2C';
      operator: number;
      isVat: number;
      rateBp: number;
      taxable: number;
      taxes: string;
    };
    // Lines and charges of the bills and credit notes in the period, not cancelled ones.
    const rows = this.db
      .prepare<{ branchId: string; from: string; to: string }, Row>(
        `SELECT i.id AS invoiceId, CASE i.kind WHEN 'INVOICE' THEN 1 ELSE -1 END AS sign, i.supply_type AS supplyType,
                i.gst_paid_by_operator AS operator, coalesce(tg.tax_type = 'VAT', 0) AS isVat,
                l.tax_rate_bp AS rateBp, l.taxable_value AS taxable, l.taxes_json AS taxes
           FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
           LEFT JOIN tax_groups tg ON tg.id = l.tax_group_id
          WHERE i.branch_id = @branchId AND i.business_date BETWEEN @from AND @to AND i.status <> 'CANCELLED'
         UNION ALL
         SELECT i.id, CASE i.kind WHEN 'INVOICE' THEN 1 ELSE -1 END, i.supply_type, i.gst_paid_by_operator, 0,
                coalesce((SELECT sum(json_extract(t.value, '$.rateBp')) FROM json_each(c.taxes_json) t), 0),
                c.amount, c.taxes_json
           FROM invoice_charges c JOIN invoices i ON i.id = c.invoice_id
          WHERE i.branch_id = @branchId AND i.business_date BETWEEN @from AND @to AND i.status <> 'CANCELLED'`,
      )
      .all({ branchId, from, to });
    const outward = new Map<
      string,
      GstSummaryView['outward'][number] & { invoices: Set<string> }
    >();
    const operatorPaid = { taxableValue: 0, invoices: new Set<string>() };
    const vat = { taxableValue: 0, vat: 0, surcharge: 0 };
    for (const r of rows) {
      const taxes = JSON.parse(r.taxes) as { code: string; amount: number }[];
      const amountOf = (code: string) =>
        r.sign * taxes.filter((t) => t.code === code).reduce((s, t) => s + t.amount, 0);
      if (r.isVat === 1) {
        vat.taxableValue += r.sign * r.taxable;
        vat.vat += amountOf('VAT');
        vat.surcharge += amountOf('SURCHARGE');
        continue;
      }
      if (r.operator === 1) {
        operatorPaid.taxableValue += r.sign * r.taxable;
        if (r.sign > 0) operatorPaid.invoices.add(r.invoiceId);
        continue;
      }
      const key = `${r.supplyType}|${r.rateBp}`;
      const row = outward.get(key) ?? {
        supplyType: r.supplyType,
        rateBp: r.rateBp,
        taxableValue: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        invoiceCount: 0,
        invoices: new Set<string>(),
      };
      row.taxableValue += r.sign * r.taxable;
      row.cgst += amountOf('CGST');
      row.sgst += amountOf('SGST');
      row.igst += amountOf('IGST');
      row.cess += amountOf('CESS');
      if (r.sign > 0) row.invoices.add(r.invoiceId);
      outward.set(key, row);
    }
    const accounts = this.totals(branchId, from, to);
    const tagged = (tag: string) => {
      const a = accounts.find((x) => x.systemTag === tag);
      return a ? normalBalance(a.type, a.debit, a.credit) : 0;
    };
    const outputTax = {
      cgst: tagged('OUTPUT_CGST'),
      sgst: tagged('OUTPUT_SGST'),
      igst: tagged('OUTPUT_IGST'),
      cess: tagged('OUTPUT_CESS'),
    };
    const inputTax = {
      cgst: tagged('INPUT_CGST'),
      sgst: tagged('INPUT_SGST'),
      igst: tagged('INPUT_IGST'),
      cess: 0,
    };
    return {
      from,
      to,
      outward: [...outward.values()]
        .sort((a, b) => a.supplyType.localeCompare(b.supplyType) || a.rateBp - b.rateBp)
        .map(({ invoices, ...row }) => ({ ...row, invoiceCount: invoices.size })),
      operatorPaid: {
        taxableValue: operatorPaid.taxableValue,
        invoiceCount: operatorPaid.invoices.size,
      },
      outputTax,
      inputTax,
      netPayable: {
        cgst: outputTax.cgst - inputTax.cgst,
        sgst: outputTax.sgst - inputTax.sgst,
        igst: outputTax.igst - inputTax.igst,
        cess: outputTax.cess - inputTax.cess,
      },
      vat,
    };
  }
}

function amounts(rows: AccountRow[], amountOf: (a: AccountRow) => number) {
  return rows
    .map((a) => ({ accountId: a.id, code: a.code, name: a.name, amount: amountOf(a) }))
    .filter((a) => a.amount !== 0);
}

function sum(rows: readonly { amount: number }[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** Adds a running balance from an opening one. */
function running(
  rows: readonly Omit<LedgerEntryView, 'balance'>[],
  opening: number,
  change: (r: Omit<LedgerEntryView, 'balance'>) => number,
): LedgerEntryView[] {
  let balance = opening;
  return rows.map((r) => {
    balance += change(r);
    return { ...r, balance };
  });
}

/** "2026-10-01" → "2026-09-30". */
function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
