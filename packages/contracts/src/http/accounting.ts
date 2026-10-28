import { z } from 'zod';
import { IdSchema, PaiseSchema } from './common';

/**
 * Accounts (docs/08 Phase 4, docs/03 §4.4). The system posts journals for
 * bills, credit notes, payments, GRNs, vendor payments and stock (cost of
 * goods sold, wastage, adjustments, opening stock); people post expenses and
 * manual journals. Amounts are paise. A balance is on the account's normal
 * side: what an asset or expense holds, what a liability, equity or income
 * account owes (negative when it has crossed over).
 */
const Version = z.number().int();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Seeded accounts have readable ids ("<organisation>:1000"), added ones UUIDs. */
const AccountId = z.string().min(1).max(80);
const Amount = PaiseSchema.nonnegative().max(100_000_000_000);

export const AccountTypeSchema = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
export type AccountType = z.infer<typeof AccountTypeSchema>;
export const JournalSourceTypeSchema = z.enum([
  'INVOICE',
  'CREDIT_NOTE',
  'PAYMENT',
  'GRN',
  'VENDOR_PAYMENT',
  'EXPENSE',
  'STOCK',
  'MANUAL',
]);
export type JournalSourceType = z.infer<typeof JournalSourceTypeSchema>;
export const PartyTypeSchema = z.enum(['CUSTOMER', 'VENDOR', 'EMPLOYEE']);

// ---- chart of accounts ---------------------------------------------------------------
export const AccountSchema = z.object({
  id: AccountId,
  code: z.string(),
  name: z.string(),
  type: AccountTypeSchema,
  parentId: AccountId.nullable(),
  /** CASH, BANK, AR, AP, SALES_FOOD, OUTPUT_CGST … for accounts automatic postings use. */
  systemTag: z.string().nullable(),
  isActive: z.boolean(),
  /** In this branch, all time, on the normal side. */
  balance: PaiseSchema,
  version: Version,
});
export type Account = z.infer<typeof AccountSchema>;
export const AccountsResponseSchema = z.object({ data: z.array(AccountSchema) });
export type AccountsResponse = z.infer<typeof AccountsResponseSchema>;

export const SaveAccountRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{3,6}$/, '3 to 6 digits'),
  name: z.string().trim().min(1).max(120),
  type: AccountTypeSchema,
  parentId: AccountId.nullable().default(null),
});
/** System accounts can be renamed but not retired; an account with postings keeps its type. */
export const UpdateAccountRequestSchema = z.object({
  version: Version,
  name: z.string().trim().min(1).max(120).optional(),
  type: AccountTypeSchema.optional(),
  parentId: AccountId.nullable().optional(),
  isActive: z.boolean().optional(),
});

// ---- journal entries ------------------------------------------------------------------
export const JournalLineSchema = z.object({
  accountId: AccountId,
  accountCode: z.string(),
  accountName: z.string(),
  debit: PaiseSchema,
  credit: PaiseSchema,
  partyType: PartyTypeSchema.nullable(),
  partyId: z.string().nullable(),
  /** The customer's or vendor's name. */
  partyName: z.string().nullable(),
  memo: z.string().nullable(),
});

export const JournalEntrySchema = z.object({
  id: IdSchema,
  /** Per branch and financial year: "KOL1/JV/2026-27/000042". */
  entryNo: z.string(),
  entryDate: z.string(),
  sourceType: JournalSourceTypeSchema,
  sourceId: z.string().nullable(),
  /** The invoice, GRN or expense number behind it, when there is one. */
  sourceNo: z.string().nullable(),
  narration: z.string().nullable(),
  reversalOfId: IdSchema.nullable(),
  reversedById: IdSchema.nullable(),
  lines: z.array(JournalLineSchema),
  total: PaiseSchema,
  createdAt: z.string(),
  /** null: posted by the system. */
  createdByName: z.string().nullable(),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;
export const JournalEntriesResponseSchema = z.object({
  data: z.array(JournalEntrySchema),
  /** Pass as `before` for the next (older) page. */
  nextCursor: z.string().nullable(),
});
export type JournalEntriesResponse = z.infer<typeof JournalEntriesResponseSchema>;
export const JournalEntriesQuerySchema = z.object({
  from: Day.optional(),
  to: Day.optional(),
  sourceType: JournalSourceTypeSchema.optional(),
  accountId: AccountId.optional(),
  before: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** A manual journal: an opening balance, a correction, a transfer between accounts. */
export const PostJournalRequestSchema = z.object({
  entryDate: Day,
  narration: z.string().trim().min(3).max(300),
  lines: z
    .array(
      z.object({
        accountId: AccountId,
        debit: Amount.default(0),
        credit: Amount.default(0),
        partyType: PartyTypeSchema.nullable().default(null),
        partyId: z.string().max(80).nullable().default(null),
        memo: z.string().trim().max(200).nullable().default(null),
      }),
    )
    .min(2)
    .max(50),
});
export type PostJournalRequest = z.input<typeof PostJournalRequestSchema>;
/** Manual entries are corrected by reversing them; documents by cancelling or refunding them. */
export const ReverseJournalRequestSchema = z.object({
  reason: z.string().trim().min(3).max(200),
  /** Defaults to today's business day. */
  entryDate: Day.optional(),
});

// ---- expenses -------------------------------------------------------------------------------
export const ExpenseSchema = z.object({
  id: IdSchema,
  expenseAccountId: AccountId,
  expenseAccountName: z.string(),
  paidFromAccountId: AccountId,
  paidFromAccountName: z.string(),
  /** What was paid, including the input GST in `taxAmount`. */
  amount: PaiseSchema,
  taxAmount: PaiseSchema,
  description: z.string(),
  reference: z.string().nullable(),
  expenseDate: z.string(),
  status: z.enum(['POSTED', 'CANCELLED']),
  cancelReason: z.string().nullable(),
  journalEntryId: IdSchema.nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  version: Version,
});
export type Expense = z.infer<typeof ExpenseSchema>;
export const ExpensesResponseSchema = z.object({ data: z.array(ExpenseSchema) });

/** An expense account (type EXPENSE) paid from cash or the bank (an asset). */
export const RecordExpenseRequestSchema = z.object({
  expenseAccountId: AccountId,
  paidFromAccountId: AccountId,
  amount: PaiseSchema.positive().max(100_000_000_000),
  /** Intra-state GST included in `amount`, claimed as input CGST + SGST. */
  taxAmount: PaiseSchema.nonnegative().default(0),
  description: z.string().trim().min(3).max(200),
  reference: z.string().trim().min(1).max(60).nullable().default(null),
  /** Defaults to today's business day. */
  expenseDate: Day.optional(),
});
export const CancelExpenseRequestSchema = z.object({
  version: Version,
  reason: z.string().trim().min(3).max(200),
});

// ---- ledgers ----------------------------------------------------------------------------------
const LedgerEntry = z.object({
  journalEntryId: IdSchema,
  entryNo: z.string(),
  date: z.string(),
  sourceType: JournalSourceTypeSchema,
  sourceNo: z.string().nullable(),
  narration: z.string().nullable(),
  /** The other account(s) of the entry. */
  against: z.string(),
  debit: PaiseSchema,
  credit: PaiseSchema,
  /** Running, on the normal side. */
  balance: PaiseSchema,
});

export const LedgerSchema = z.object({
  account: AccountSchema,
  from: z.string(),
  to: z.string(),
  openingBalance: PaiseSchema,
  entries: z.array(LedgerEntry),
  totalDebit: PaiseSchema,
  totalCredit: PaiseSchema,
  closingBalance: PaiseSchema,
});
export type Ledger = z.infer<typeof LedgerSchema>;

/** A customer's (receivables) or vendor's (payables) own ledger. */
export const PartyLedgerSchema = z.object({
  partyType: PartyTypeSchema,
  partyId: z.string(),
  partyName: z.string(),
  from: z.string(),
  to: z.string(),
  /** What they owe us (customer) or we owe them (vendor). */
  openingBalance: PaiseSchema,
  entries: z.array(LedgerEntry),
  closingBalance: PaiseSchema,
});
export type PartyLedger = z.infer<typeof PartyLedgerSchema>;

// ---- financial statements ------------------------------------------------------------------------
const AccountAmount = z.object({
  accountId: AccountId,
  code: z.string(),
  name: z.string(),
  amount: PaiseSchema,
});

export const TrialBalanceSchema = z.object({
  asOf: z.string(),
  rows: z.array(
    z.object({
      accountId: AccountId,
      code: z.string(),
      name: z.string(),
      type: AccountTypeSchema,
      debit: PaiseSchema,
      credit: PaiseSchema,
    }),
  ),
  totalDebit: PaiseSchema,
  totalCredit: PaiseSchema,
  balanced: z.boolean(),
});
export type TrialBalance = z.infer<typeof TrialBalanceSchema>;

export const ProfitAndLossSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Sales less returns, service charge, rounding. */
  income: z.array(AccountAmount),
  totalIncome: PaiseSchema,
  costOfSales: z.array(AccountAmount),
  totalCostOfSales: PaiseSchema,
  grossProfit: PaiseSchema,
  /** grossProfit ÷ totalIncome, basis points. */
  grossMarginBp: z.number().int().nullable(),
  expenses: z.array(AccountAmount),
  totalExpenses: PaiseSchema,
  netProfit: PaiseSchema,
});
export type ProfitAndLoss = z.infer<typeof ProfitAndLossSchema>;

export const BalanceSheetSchema = z.object({
  asOf: z.string(),
  assets: z.array(AccountAmount),
  totalAssets: PaiseSchema,
  liabilities: z.array(AccountAmount),
  totalLiabilities: PaiseSchema,
  equity: z.array(AccountAmount),
  /** Income less expenses to date, not yet closed into retained earnings. */
  profitToDate: PaiseSchema,
  totalEquity: PaiseSchema,
  /** totalAssets = totalLiabilities + totalEquity. */
  balanced: z.boolean(),
});
export type BalanceSheet = z.infer<typeof BalanceSheetSchema>;

/** Cash, bank and card/UPI clearing, by where the money came from or went. */
export const CashFlowSchema = z.object({
  from: z.string(),
  to: z.string(),
  openingCash: PaiseSchema,
  inflows: z.array(z.object({ category: z.string(), amount: PaiseSchema })),
  outflows: z.array(z.object({ category: z.string(), amount: PaiseSchema })),
  netChange: PaiseSchema,
  closingCash: PaiseSchema,
  accounts: z.array(AccountAmount),
});
export type CashFlow = z.infer<typeof CashFlowSchema>;

const GstHeads = { cgst: PaiseSchema, sgst: PaiseSchema, igst: PaiseSchema, cess: PaiseSchema };

/**
 * For the accountant's returns. Outward supplies (GSTR-1) per rate from the
 * invoices, net of credit notes, B2B and B2C apart; the GSTR-3B summary from
 * the ledgers: output tax, input credit from GRNs and expenses, net payable.
 * Liquor VAT is outside GST and shown on its own.
 */
export const GstSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  outward: z.array(
    z.object({
      supplyType: z.enum(['B2B', 'B2C']),
      rateBp: z.number().int(),
      taxableValue: PaiseSchema,
      ...GstHeads,
      invoiceCount: z.number().int(),
    }),
  ),
  /** Aggregator orders where the operator pays the GST (section 9(5)). */
  operatorPaid: z.object({ taxableValue: PaiseSchema, invoiceCount: z.number().int() }),
  outputTax: z.object(GstHeads),
  inputTax: z.object(GstHeads),
  netPayable: z.object(GstHeads),
  vat: z.object({ taxableValue: PaiseSchema, vat: PaiseSchema, surcharge: PaiseSchema }),
});
export type GstSummary = z.infer<typeof GstSummarySchema>;
