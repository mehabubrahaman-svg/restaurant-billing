import type { AccountType, JournalLine } from '@restroos/domain';

export type JournalSourceType =
  'INVOICE' | 'CREDIT_NOTE' | 'PAYMENT' | 'GRN' | 'VENDOR_PAYMENT' | 'EXPENSE' | 'STOCK' | 'MANUAL';
export type PartyType = 'CUSTOMER' | 'VENDOR' | 'EMPLOYEE';

/** The accounts automatic postings use, by `accounts.system_tag` (seeded in migration 0012). */
export type SystemAccount =
  | 'CASH'
  | 'BANK'
  | 'CARD_UPI_CLEARING'
  | 'AR'
  | 'AGGREGATOR_RECEIVABLE'
  | 'INVENTORY'
  | 'INPUT_CGST'
  | 'INPUT_SGST'
  | 'INPUT_IGST'
  | 'AP'
  | 'OUTPUT_CGST'
  | 'OUTPUT_SGST'
  | 'OUTPUT_IGST'
  | 'OUTPUT_CESS'
  | 'OUTPUT_VAT'
  | 'OUTPUT_SURCHARGE'
  | 'CAPITAL'
  | 'OPENING_EQUITY'
  | 'RETAINED_EARNINGS'
  | 'SALES_FOOD'
  | 'SALES_LIQUOR'
  | 'SERVICE_CHARGE'
  | 'ROUND_OFF'
  | 'SALES_RETURNS'
  | 'COGS'
  | 'WASTAGE'
  | 'STOCK_ADJUSTMENT'
  | 'AGGREGATOR_COMMISSION'
  | 'OTHER_EXPENSE';

export interface AccountRecord {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  systemTag: string | null;
  isActive: boolean;
  version: number;
}

export interface NewJournalEntry {
  id: string;
  branchId: string;
  entryNo: string;
  entryDate: string;
  sourceType: JournalSourceType;
  sourceId: string | null;
  narration: string | null;
  reversalOfId: string | null;
  createdBy: string | null;
}

export interface PostedEntry {
  id: string;
  branchId: string;
  entryDate: string;
  sourceType: JournalSourceType;
  sourceId: string | null;
  reversalOfId: string | null;
  lines: JournalLine[];
}

export interface ExpenseRecord {
  id: string;
  branchId: string;
  expenseAccountId: string;
  paidFromAccountId: string;
  amount: number;
  taxAmount: number;
  description: string;
  reference: string | null;
  expenseDate: string;
  isCancelled: boolean;
  version: number;
}

export interface AccountingRepository {
  accounts(): AccountRecord[];
  account(id: string): AccountRecord | undefined;
  accountByCode(code: string): AccountRecord | undefined;
  accountByTag(tag: SystemAccount): AccountRecord | undefined;
  insertAccount(record: AccountRecord, at: Date): void;
  /** Version-checked. */
  updateAccount(record: AccountRecord, at: Date): void;
  hasPostings(accountId: string): boolean;

  insertEntry(entry: NewJournalEntry, lines: readonly JournalLine[], at: Date): void;
  entry(branchId: string, id: string): PostedEntry | undefined;
  /** The original (not a reversal) entry posted for a document. */
  originalEntry(sourceType: JournalSourceType, sourceId: string): PostedEntry | undefined;
  /** The entry that reversed this one, if any. */
  reversalOf(entryId: string): string | undefined;
  nextEntryNo(branchId: string, fiscalYear: string, branchCode: string): string;

  insertExpense(record: ExpenseRecord, actorId: string, at: Date): void;
  expense(branchId: string, id: string): ExpenseRecord | undefined;
  /** Version-checked soft delete. */
  cancelExpense(
    id: string,
    expectedVersion: number,
    reason: string,
    actorId: string | null,
    at: Date,
  ): void;
}

/** A bill or credit note as the sales journal needs it. */
export interface InvoicePosting {
  id: string;
  branchId: string;
  invoiceNo: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  businessDate: string;
  customerId: string | null;
  grandTotal: number;
  chargesTotal: number;
  roundOff: number;
  /** Taxable value of the lines, food (GST) and liquor (VAT) apart. */
  sales: { liquor: boolean; taxable: number }[];
  taxes: { code: 'CGST' | 'SGST' | 'IGST' | 'VAT' | 'SURCHARGE' | 'CESS'; amount: number }[];
}

export interface PaymentPosting {
  id: string;
  branchId: string;
  invoiceNo: string;
  method: string;
  /** Negative for refunds. */
  amount: number;
  businessDate: string;
  customerId: string | null;
}

export interface GrnPosting {
  id: string;
  branchId: string;
  grnNo: string;
  vendorId: string;
  vendorInvoiceNo: string | null;
  businessDate: string;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  inputTaxKind: 'CGST_SGST' | 'IGST' | 'NONE';
}

export interface VendorPaymentPosting {
  id: string;
  branchId: string;
  vendorId: string;
  vendorName: string;
  method: 'CASH' | 'BANK' | 'UPI' | 'CHEQUE';
  amount: number;
  paidOn: string;
}

export interface StockMovementPosting {
  /** stock_movements.rowid: the projector's cursor. */
  seq: number;
  id: string;
  branchId: string;
  businessDate: string;
  type: string;
  referenceType: string | null;
  /** qty_milli × unit_cost_per_base (signed). */
  rawValue: number;
}

/** The documents automatic journals are posted from. */
export interface PostingSources {
  invoice(id: string): InvoicePosting | undefined;
  payments(invoiceId: string): PaymentPosting[];
  grn(id: string): GrnPosting | undefined;
  vendorPayment(id: string): VendorPaymentPosting | undefined;
  stockMovementsAfter(seq: number, limit: number): StockMovementPosting[];
}

// ---- read models (shapes match packages/contracts accounting.ts) -----------------------
export interface AccountView extends AccountRecord {
  balance: number;
}

export interface JournalEntryView {
  id: string;
  entryNo: string;
  entryDate: string;
  sourceType: JournalSourceType;
  sourceId: string | null;
  sourceNo: string | null;
  narration: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    partyType: PartyType | null;
    partyId: string | null;
    partyName: string | null;
    memo: string | null;
  }[];
  total: number;
  createdAt: string;
  createdByName: string | null;
}

export interface ExpenseView {
  id: string;
  expenseAccountId: string;
  expenseAccountName: string;
  paidFromAccountId: string;
  paidFromAccountName: string;
  amount: number;
  taxAmount: number;
  description: string;
  reference: string | null;
  expenseDate: string;
  status: 'POSTED' | 'CANCELLED';
  cancelReason: string | null;
  journalEntryId: string | null;
  createdAt: string;
  createdByName: string | null;
  version: number;
}

export interface LedgerEntryView {
  journalEntryId: string;
  entryNo: string;
  date: string;
  sourceType: JournalSourceType;
  sourceNo: string | null;
  narration: string | null;
  against: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface LedgerView {
  account: AccountView;
  from: string;
  to: string;
  openingBalance: number;
  entries: LedgerEntryView[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

export interface PartyLedgerView {
  partyType: PartyType;
  partyId: string;
  partyName: string;
  from: string;
  to: string;
  openingBalance: number;
  entries: LedgerEntryView[];
  closingBalance: number;
}

interface AccountAmountView {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface TrialBalanceView {
  asOf: string;
  rows: {
    accountId: string;
    code: string;
    name: string;
    type: AccountType;
    debit: number;
    credit: number;
  }[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface ProfitAndLossView {
  from: string;
  to: string;
  income: AccountAmountView[];
  totalIncome: number;
  costOfSales: AccountAmountView[];
  totalCostOfSales: number;
  grossProfit: number;
  grossMarginBp: number | null;
  expenses: AccountAmountView[];
  totalExpenses: number;
  netProfit: number;
}

export interface BalanceSheetView {
  asOf: string;
  assets: AccountAmountView[];
  totalAssets: number;
  liabilities: AccountAmountView[];
  totalLiabilities: number;
  equity: AccountAmountView[];
  profitToDate: number;
  totalEquity: number;
  balanced: boolean;
}

export interface CashFlowView {
  from: string;
  to: string;
  openingCash: number;
  inflows: { category: string; amount: number }[];
  outflows: { category: string; amount: number }[];
  netChange: number;
  closingCash: number;
  accounts: AccountAmountView[];
}

interface GstHeadsView {
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export interface GstSummaryView {
  from: string;
  to: string;
  outward: (GstHeadsView & {
    supplyType: 'B2B' | 'B2C';
    rateBp: number;
    taxableValue: number;
    invoiceCount: number;
  })[];
  operatorPaid: { taxableValue: number; invoiceCount: number };
  outputTax: GstHeadsView;
  inputTax: GstHeadsView;
  netPayable: GstHeadsView;
  vat: { taxableValue: number; vat: number; surcharge: number };
}

export interface AccountingQueries {
  accounts(branchId: string): AccountView[];
  account(branchId: string, id: string): AccountView | undefined;
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
  ): JournalEntryView[];
  entry(branchId: string, id: string): JournalEntryView | undefined;
  expenses(
    branchId: string,
    filter: { from?: string | undefined; to?: string | undefined },
  ): ExpenseView[];
  expense(branchId: string, id: string): ExpenseView | undefined;
  ledger(branchId: string, accountId: string, from: string, to: string): LedgerView | undefined;
  partyLedger(
    branchId: string,
    partyType: PartyType,
    partyId: string,
    from: string,
    to: string,
  ): PartyLedgerView | undefined;
  trialBalance(branchId: string, asOf: string): TrialBalanceView;
  profitAndLoss(branchId: string, from: string, to: string): ProfitAndLossView;
  balanceSheet(branchId: string, asOf: string): BalanceSheetView;
  cashFlow(branchId: string, from: string, to: string): CashFlowView;
  gstSummary(branchId: string, from: string, to: string): GstSummaryView;
}
