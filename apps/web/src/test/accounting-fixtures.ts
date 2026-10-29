import type {
  Account,
  AccountType,
  BalanceSheet,
  CashFlow,
  Expense,
  GstSummary,
  JournalEntry,
  Ledger,
  ProfitAndLoss,
  TrialBalance,
} from '@restroos/contracts';

export const ENTRY_MANUAL_ID = '0f600000-0000-4000-8000-000000000001';
export const ENTRY_BILL_ID = '0f600000-0000-4000-8000-000000000002';
export const ENTRY_STOCK_ID = '0f600000-0000-4000-8000-000000000003';
export const EXPENSE_ID = '0f700000-0000-4000-8000-000000000001';

/** Seeded accounts have readable ids ("<organisation>:<code>"). */
export const accountId = (code: string) => `org1:${code}`;

const account = (
  code: string,
  name: string,
  type: AccountType,
  systemTag: string | null,
  balance: number,
  overrides: Partial<Account> = {},
): Account => ({
  id: accountId(code),
  code,
  name,
  type,
  parentId: null,
  systemTag,
  isActive: true,
  balance,
  version: 1,
  ...overrides,
});

/** Part of the seeded chart after a day of trade (see apps/server accounting.test.ts), plus one added account. */
export const CHART: Account[] = [
  account('1000', 'Cash in hand', 'ASSET', 'CASH', 426_500),
  account('1010', 'Bank account', 'ASSET', 'BANK', 900_000),
  account('1020', 'Card and UPI clearing', 'ASSET', 'CARD_UPI_CLEARING', 50_000),
  account('1200', 'Inventory', 'ASSET', 'INVENTORY', 292_275),
  account('1300', 'Input CGST', 'ASSET', 'INPUT_CGST', 14_625),
  account('2000', 'Vendor payables', 'LIABILITY', 'AP', 136_250),
  account('2100', 'Output CGST', 'LIABILITY', 'OUTPUT_CGST', 2_250),
  account('3000', 'Owner’s capital', 'EQUITY', 'CAPITAL', 1_500_000),
  account('4000', 'Food and beverage sales', 'INCOME', 'SALES_FOOD', 96_000),
  account('4900', 'Sales returns', 'INCOME', 'SALES_RETURNS', -6_000),
  account('5000', 'Cost of goods sold', 'EXPENSE', 'COGS', 4_000),
  account('6020', 'Electricity and gas', 'EXPENSE', null, 100_000),
  account('6050', 'Staff meals', 'EXPENSE', null, 0, {
    id: '0f800000-0000-4000-8000-000000000001',
  }),
];

export const byCode = (code: string): Account => CHART.find((a) => a.code === code)!;

const line = (code: string, debit: number, credit: number, extra: object = {}) => ({
  accountId: byCode(code).id,
  accountCode: code,
  accountName: byCode(code).name,
  debit,
  credit,
  partyType: null,
  partyId: null,
  partyName: null,
  memo: null,
  ...extra,
});

export function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: ENTRY_MANUAL_ID,
    entryNo: 'KOL1/JV/2026-27/000001',
    entryDate: '2026-10-28',
    sourceType: 'MANUAL',
    sourceId: null,
    sourceNo: null,
    narration: 'Capital brought in',
    reversalOfId: null,
    reversedById: null,
    lines: [line('1000', 500_000, 0), line('1010', 1_000_000, 0), line('3000', 0, 1_500_000)],
    total: 1_500_000,
    createdAt: '2026-10-28T04:00:00.000Z',
    createdByName: 'Ananya Sen',
    ...overrides,
  };
}

export const billEntry = makeEntry({
  id: ENTRY_BILL_ID,
  entryNo: 'KOL1/JV/2026-27/000004',
  sourceType: 'INVOICE',
  sourceId: '0d000000-0000-4000-8000-000000000001',
  sourceNo: 'KOL1/2026-27/000001',
  narration: 'Bill KOL1/2026-27/000001',
  lines: [
    {
      ...line('1000', 100_800, 0),
      accountId: accountId('1100'),
      accountCode: '1100',
      accountName: 'Customer receivables',
      partyType: 'CUSTOMER',
      partyId: '0e300000-0000-4000-8000-000000000001',
      partyName: 'Asha Roy',
    },
    line('4000', 0, 96_000),
    line('2100', 0, 4_800),
  ],
  total: 100_800,
  createdAt: '2026-10-28T13:00:00.000Z',
  createdByName: 'Meera Saha',
});

export const stockEntry = makeEntry({
  id: ENTRY_STOCK_ID,
  entryNo: 'KOL1/JV/2026-27/000003',
  sourceType: 'STOCK',
  narration: 'Cost of goods sold',
  // The Hub posts the inventory side first.
  lines: [line('1200', 0, 4_000), line('5000', 4_000, 0)],
  total: 4_000,
  createdAt: '2026-10-28T12:30:00.000Z',
  createdByName: null,
});

export function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: EXPENSE_ID,
    expenseAccountId: byCode('6020').id,
    expenseAccountName: 'Electricity and gas',
    paidFromAccountId: byCode('1000').id,
    paidFromAccountName: 'Cash in hand',
    amount: 118_000,
    taxAmount: 18_000,
    description: 'CESC bill, October',
    reference: 'CESC-10',
    expenseDate: '2026-10-28',
    status: 'POSTED',
    cancelReason: null,
    journalEntryId: '0f600000-0000-4000-8000-000000000009',
    createdAt: '2026-10-28T11:00:00.000Z',
    createdByName: 'Tapas Roy',
    version: 1,
    ...overrides,
  };
}

export function makeTrialBalance(overrides: Partial<TrialBalance> = {}): TrialBalance {
  return {
    asOf: '2026-10-28',
    rows: [
      {
        accountId: byCode('1000').id,
        code: '1000',
        name: 'Cash in hand',
        type: 'ASSET',
        debit: 426_500,
        credit: 0,
      },
      {
        accountId: byCode('3000').id,
        code: '3000',
        name: 'Owner’s capital',
        type: 'EQUITY',
        debit: 0,
        credit: 1_500_000,
      },
      {
        accountId: byCode('1010').id,
        code: '1010',
        name: 'Bank account',
        type: 'ASSET',
        debit: 1_073_500,
        credit: 0,
      },
    ],
    totalDebit: 1_500_000,
    totalCredit: 1_500_000,
    balanced: true,
    ...overrides,
  };
}

/** The day of trade in the server's accounting test: a net loss after the electricity bill. */
export function makeProfitAndLoss(overrides: Partial<ProfitAndLoss> = {}): ProfitAndLoss {
  const row = (code: string, amount: number) => ({
    accountId: byCode(code).id,
    code,
    name: byCode(code).name,
    amount,
  });
  return {
    from: '2026-10-01',
    to: '2026-10-28',
    income: [row('4000', 96_000), row('4900', -6_000)],
    totalIncome: 90_000,
    costOfSales: [row('5000', 12_725)],
    totalCostOfSales: 12_725,
    grossProfit: 77_275,
    grossMarginBp: 8_586,
    expenses: [row('6020', 100_000)],
    totalExpenses: 100_000,
    netProfit: -22_725,
    ...overrides,
  };
}

export function makeBalanceSheet(overrides: Partial<BalanceSheet> = {}): BalanceSheet {
  const row = (code: string, amount: number) => ({
    accountId: byCode(code).id,
    code,
    name: byCode(code).name,
    amount,
  });
  return {
    asOf: '2026-10-28',
    assets: [
      row('1000', 426_500),
      row('1010', 900_000),
      row('1020', 50_000),
      row('1200', 292_275),
      row('1300', 29_250),
    ],
    totalAssets: 1_698_025,
    liabilities: [row('2000', 136_250), row('2100', 4_500)],
    totalLiabilities: 140_750,
    equity: [row('3000', 1_580_000)],
    profitToDate: -22_725,
    totalEquity: 1_557_275,
    balanced: true,
    ...overrides,
  };
}

export function makeCashFlow(overrides: Partial<CashFlow> = {}): CashFlow {
  const row = (code: string, amount: number) => ({
    accountId: byCode(code).id,
    code,
    name: byCode(code).name,
    amount,
  });
  return {
    from: '2026-10-01',
    to: '2026-10-28',
    openingCash: 0,
    inflows: [
      { category: 'OTHER', amount: 1_500_000 },
      { category: 'CUSTOMERS', amount: 100_800 },
    ],
    outflows: [
      { category: 'CUSTOMERS', amount: 6_300 },
      { category: 'VENDORS', amount: 100_000 },
      { category: 'EXPENSES', amount: 118_000 },
    ],
    netChange: 1_376_500,
    closingCash: 1_376_500,
    accounts: [row('1000', 426_500), row('1010', 900_000), row('1020', 50_000)],
    ...overrides,
  };
}

export function makeGstSummary(overrides: Partial<GstSummary> = {}): GstSummary {
  return {
    from: '2026-10-01',
    to: '2026-10-28',
    outward: [
      {
        supplyType: 'B2C',
        rateBp: 500,
        taxableValue: 90_000,
        cgst: 2_250,
        sgst: 2_250,
        igst: 0,
        cess: 0,
        invoiceCount: 1,
      },
    ],
    operatorPaid: { taxableValue: 12_000, invoiceCount: 1 },
    outputTax: { cgst: 2_250, sgst: 2_250, igst: 0, cess: 0 },
    inputTax: { cgst: 14_625, sgst: 14_625, igst: 0, cess: 0 },
    netPayable: { cgst: -12_375, sgst: -12_375, igst: 0, cess: 0 },
    vat: { taxableValue: 32_000, vat: 6_400, surcharge: 160 },
    ...overrides,
  };
}

/** Cash in hand over the day: capital in, a cash payment, a refund and the electricity bill. */
export function makeLedger(overrides: Partial<Ledger> = {}): Ledger {
  const entry = (
    n: number,
    sourceType: Ledger['entries'][number]['sourceType'],
    narration: string,
    against: string,
    debit: number,
    credit: number,
    balance: number,
  ) => ({
    journalEntryId: `0f600000-0000-4000-8000-00000000010${n}`,
    entryNo: `KOL1/JV/2026-27/00000${n}`,
    date: '2026-10-28',
    sourceType,
    sourceNo: null,
    narration,
    against,
    debit,
    credit,
    balance,
  });
  return {
    account: byCode('1000'),
    from: '2026-10-01',
    to: '2026-10-28',
    openingBalance: 0,
    entries: [
      entry(
        1,
        'MANUAL',
        'Capital brought in',
        'Bank account, Owner’s capital',
        500_000,
        0,
        500_000,
      ),
      entry(
        2,
        'PAYMENT',
        'Payment on KOL1/2026-27/000001 (CASH)',
        'Customer receivables',
        50_800,
        0,
        550_800,
      ),
      entry(
        3,
        'PAYMENT',
        'Refund on KOL1/CN/2026-27/000001 (CASH)',
        'Customer receivables',
        0,
        6_300,
        544_500,
      ),
      entry(
        4,
        'EXPENSE',
        'CESC bill, October',
        'Electricity and gas, Input CGST, Input SGST',
        0,
        118_000,
        426_500,
      ),
    ],
    totalDebit: 550_800,
    totalCredit: 124_300,
    closingBalance: 426_500,
    ...overrides,
  };
}
