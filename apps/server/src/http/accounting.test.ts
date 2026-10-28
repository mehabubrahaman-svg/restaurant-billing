import {
  AccountSchema,
  AccountsResponseSchema,
  BalanceSheetSchema,
  BillResponseSchema,
  CashFlowSchema,
  ExpenseSchema,
  GrnSchema,
  GstSummarySchema,
  InventoryItemSchema,
  InvoiceSchema,
  JournalEntriesResponseSchema,
  JournalEntrySchema,
  LedgerSchema,
  PartyLedgerSchema,
  ProfitAndLossSchema,
  TrialBalanceSchema,
  VendorSchema,
  type Account,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs, trail } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

const KG = 1_000_000;
const TODAY = '2026-10-28';

async function books() {
  const r = await restaurantServer();
  s = r.s;
  const captain = await signInAs(r.s, r.admin, 'CAPTAIN', 'rahul');
  const cashier = await signInAs(r.s, r.admin, 'CASHIER', 'meera');
  const accountant = await signInAs(r.s, r.admin, 'ACCOUNTANT', 'roy');
  const chart = AccountsResponseSchema.parse((await r.admin('GET', '/accounts')).json()).data;
  const byCode = (code: string): Account => chart.find((a) => a.code === code)!;
  const accounts = async () =>
    new Map(
      AccountsResponseSchema.parse((await r.admin('GET', '/accounts')).json()).data.map((a) => [
        a.code,
        a.balance,
      ]),
    );
  /** 2 × Chicken Biryani (Full) + Raita and 4 × Butter Naan at T1, fired: ₹960 + 5% GST = ₹1,008. */
  const servedOrder = async () => {
    const order = await r.openAt(captain, r.tables.t1.id);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [
        {
          menuItemId: r.menu.biryani.id,
          variantId: r.menu.full.id,
          quantity: 2,
          addons: [{ addonId: r.menu.raita.id }],
        },
        { menuItemId: r.menu.naan.id, quantity: 4 },
      ],
    });
    await captain('POST', `/orders/${order.id}/kots`);
    return order;
  };
  return { ...r, captain, cashier, accountant, byCode, accounts, servedOrder };
}

describe('accounting', () => {
  it('seeds the chart of accounts the automatic postings use', async () => {
    const { byCode } = await books();
    expect(byCode('1000')).toMatchObject({
      name: 'Cash in hand',
      type: 'ASSET',
      systemTag: 'CASH',
      balance: 0,
    });
    expect(byCode('2100')).toMatchObject({ systemTag: 'OUTPUT_CGST', type: 'LIABILITY' });
    expect(byCode('5000')).toMatchObject({ systemTag: 'COGS', type: 'EXPENSE' });
    expect(byCode('6020')).toMatchObject({ name: 'Electricity and gas', systemTag: null });
  });

  it('journals a day of trade and keeps the books balanced', async () => {
    const r = await books();
    const { admin, cashier, ok, byCode } = r;

    // The owner puts in ₹5,000 cash and ₹10,000 in the bank.
    await ok(
      admin('POST', '/journal-entries', {
        entryDate: TODAY,
        narration: 'Capital brought in',
        lines: [
          { accountId: byCode('1000').id, debit: 500_000 },
          { accountId: byCode('1010').id, debit: 1_000_000 },
          { accountId: byCode('3000').id, credit: 1_500_000 },
        ],
      }),
      JournalEntrySchema,
    );
    // 10 kg of rice on the shelf at ₹80/kg; the biryani takes 250 g a portion.
    const rice = await ok(
      admin('POST', '/inventory-items', {
        sku: 'RICE',
        name: 'Basmati rice',
        baseUnit: 'g',
        purchaseUnitId: 'unit-kg',
      }),
      InventoryItemSchema,
    );
    await admin('POST', '/stock/opening', {
      lines: [{ inventoryItemId: rice.id, qtyMilli: 10 * KG, totalCost: 80_000 }],
    });
    await admin('POST', '/recipes', {
      menuItemId: r.menu.biryani.id,
      variantId: r.menu.full.id,
      ingredients: [{ inventoryItemId: rice.id, qtyMilli: 250_000 }],
    });

    // Sell, bill and take card + cash; refund one naan in cash.
    const order = await r.servedOrder();
    const invoice = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/invoice`, {})).json(),
    ).invoices[0]!;
    await cashier('POST', '/cash-shifts', { openingFloat: 0 });
    await cashier('POST', `/invoices/${invoice.id}/payments`, {
      payments: [
        {
          method: 'CARD',
          amount: 50_000,
          reference: 'AUTH1',
          cardLast4: '4242',
          terminalLabel: 'HDFC-1',
        },
        { method: 'CASH', amount: 50_800 },
      ],
    });
    await admin('POST', '/cash-shifts', { openingFloat: 0 });
    const naan = invoice.lines.find((l) => l.description === 'Butter Naan')!;
    const refund = await admin('POST', `/invoices/${invoice.id}/refunds`, {
      lines: [{ invoiceLineId: naan.id, quantity: 1 }],
      method: 'CASH',
      reason: 'Naan was burnt',
    });
    expect(refund.statusCode).toBe(201);

    // Buy 25 kg of rice at ₹90/kg + 5% GST from a West Bengal vendor, pay ₹1,000 by bank.
    const vendor = await ok(
      admin('POST', '/vendors', {
        code: 'FRESH',
        name: 'Fresh Farms',
        taxId: '19AAACF1234A1Z5',
        paymentTermsDays: 15,
      }),
      VendorSchema,
    );
    const draft = await ok(
      admin('POST', '/grns', {
        vendorId: vendor.id,
        vendorInvoiceNo: 'FF/1123',
        lines: [
          {
            inventoryItemId: rice.id,
            unitId: 'unit-kg',
            quantityMilli: 25_000,
            unitPrice: 9_000,
            taxRateBp: 500,
          },
        ],
      }),
      GrnSchema,
    );
    const grn = await ok(
      admin('POST', `/grns/${draft.id}/post`, { version: draft.version }),
      GrnSchema,
    );
    await admin('POST', '/vendor-payments', {
      vendorId: vendor.id,
      grnId: grn.id,
      method: 'BANK',
      amount: 100_000,
      reference: 'UTR9',
    });

    // The electricity bill, ₹1,180 with ₹180 GST, paid from the till; and 1 kg of rice spoils.
    const expense = await ok(
      r.accountant('POST', '/expenses', {
        expenseAccountId: byCode('6020').id,
        paidFromAccountId: byCode('1000').id,
        amount: 118_000,
        taxAmount: 18_000,
        description: 'CESC bill, October',
        reference: 'CESC-10',
      }),
      ExpenseSchema,
    );
    expect(expense).toMatchObject({ status: 'POSTED', createdByName: 'roy' });
    expect(trail(r.s, expense.id)).toEqual({
      audit: ['accounts.expense.create'],
      events: ['ExpenseRecorded'],
      queued: 1,
    });
    await admin('POST', '/stock/wastage', {
      reason: 'Damp sack',
      lines: [{ inventoryItemId: rice.id, qtyMilli: KG }],
    });

    const journal = JournalEntriesResponseSchema.parse(
      (await r.accountant('GET', '/journal-entries')).json(),
    ).data;
    expect(journal.map((e) => [e.sourceType, e.total, e.narration]).reverse()).toEqual([
      ['MANUAL', 1_500_000, 'Capital brought in'],
      ['STOCK', 80_000, 'Opening stock'],
      // 500 g of rice at ₹80/kg
      ['STOCK', 4_000, 'Cost of goods sold'],
      ['INVOICE', 100_800, `Bill ${invoice.invoiceNo}`],
      ['PAYMENT', 50_000, `Payment on ${invoice.invoiceNo} (CARD)`],
      ['PAYMENT', 50_800, `Payment on ${invoice.invoiceNo} (CASH)`],
      ['CREDIT_NOTE', 6_300, 'Credit note KOL1/CN/2026-27/000001'],
      ['PAYMENT', 6_300, 'Refund on KOL1/CN/2026-27/000001 (CASH)'],
      ['GRN', 236_250, `GRN ${grn.grnNo}, bill FF/1123`],
      ['VENDOR_PAYMENT', 100_000, 'Paid Fresh Farms (BANK)'],
      ['EXPENSE', 118_000, 'CESC bill, October'],
      // 1 kg at the new average: (9.5 kg × ₹80 + 25 kg × ₹90) ÷ 34.5 kg = ₹87.25
      ['STOCK', 8_725, 'Wastage'],
    ]);
    const bill = journal.find((e) => e.sourceType === 'INVOICE')!;
    expect(bill).toMatchObject({
      entryNo: 'KOL1/JV/2026-27/000004',
      sourceNo: invoice.invoiceNo,
      createdByName: 'meera',
    });
    expect(bill.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['1100', 100_800, 0],
      ['4000', 0, 96_000],
      ['2100', 0, 2_400],
      ['2110', 0, 2_400],
    ]);
    expect(
      journal
        .find((e) => e.sourceType === 'GRN')!
        .lines.map((l) => [l.accountCode, l.debit, l.credit, l.partyName]),
    ).toEqual([
      ['1200', 225_000, 0, null],
      ['1300', 5_625, 0, null],
      ['1310', 5_625, 0, null],
      ['2000', 0, 236_250, 'Fresh Farms'],
    ]);
    expect(journal.at(-1)!.createdByName).toBe('Ananya Sen');
    expect(journal[0]!.createdByName).toBeNull();

    // Posted once: catching up again finds nothing new.
    expect(r.s.container.cradle.accountingProjector.catchUp()).toBe(0);

    const balances = await r.accounts();
    expect(
      Object.fromEntries(
        ['1000', '1010', '1020', '1100', '1200', '1300', '2000', '2100'].map((c) => [
          c,
          balances.get(c),
        ]),
      ),
    ).toEqual({
      '1000': 500_000 + 50_800 - 6_300 - 118_000,
      '1010': 1_000_000 - 100_000,
      '1020': 50_000,
      '1100': 0,
      '1200': 80_000 - 4_000 + 225_000 - 8_725,
      '1300': 5_625 + 9_000,
      '2000': 236_250 - 100_000,
      '2100': 2_400 - 150,
    });

    const tb = await ok(r.accountant('GET', '/reports/trial-balance'), TrialBalanceSchema);
    expect(tb).toMatchObject({ balanced: true, totalDebit: tb.totalCredit });

    const pnl = await ok(
      r.accountant('GET', `/reports/profit-and-loss?from=${TODAY}&to=${TODAY}`),
      ProfitAndLossSchema,
    );
    expect(pnl.income.map((i) => [i.code, i.amount])).toEqual([
      ['4000', 96_000],
      ['4900', -6_000],
    ]);
    expect(pnl).toMatchObject({
      totalIncome: 90_000,
      totalCostOfSales: 12_725,
      grossProfit: 77_275,
      grossMarginBp: 8_586,
      totalExpenses: 100_000,
      netProfit: -22_725,
    });

    const bs = await ok(r.accountant('GET', '/reports/balance-sheet'), BalanceSheetSchema);
    expect(bs).toMatchObject({
      totalAssets: 1_698_025,
      totalLiabilities: 140_750,
      profitToDate: -22_725,
      totalEquity: 1_557_275,
      balanced: true,
    });

    const cash = await ok(
      r.accountant('GET', `/reports/cash-flow?from=${TODAY}&to=${TODAY}`),
      CashFlowSchema,
    );
    expect(cash).toMatchObject({ openingCash: 0, netChange: 1_376_500, closingCash: 1_376_500 });
    expect(Object.fromEntries(cash.inflows.map((f) => [f.category, f.amount]))).toEqual({
      OTHER: 1_500_000,
      CUSTOMERS: 100_800,
    });
    expect(Object.fromEntries(cash.outflows.map((f) => [f.category, f.amount]))).toEqual({
      CUSTOMERS: 6_300,
      VENDORS: 100_000,
      EXPENSES: 118_000,
    });

    const gst = await ok(
      r.accountant('GET', `/reports/gst-summary?from=${TODAY}&to=${TODAY}`),
      GstSummarySchema,
    );
    expect(gst.outward).toEqual([
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
    ]);
    expect(gst.outputTax).toEqual({ cgst: 2_250, sgst: 2_250, igst: 0, cess: 0 });
    expect(gst.inputTax).toEqual({ cgst: 14_625, sgst: 14_625, igst: 0, cess: 0 });
    expect(gst.netPayable.cgst).toBe(-12_375);

    const ledger = await ok(
      r.accountant('GET', `/ledgers/${byCode('1000').id}?from=${TODAY}&to=${TODAY}`),
      LedgerSchema,
    );
    expect(ledger.entries.map((e) => [e.debit, e.credit, e.balance])).toEqual([
      [500_000, 0, 500_000],
      [50_800, 0, 550_800],
      [0, 6_300, 544_500],
      [0, 118_000, 426_500],
    ]);
    expect(ledger.entries[3]!.against).toBe('Electricity and gas, Input CGST, Input SGST');
    const party = await ok(
      r.accountant('GET', `/ledgers/party/VENDOR/${vendor.id}?from=${TODAY}&to=${TODAY}`),
      PartyLedgerSchema,
    );
    expect(party).toMatchObject({
      partyName: 'Fresh Farms',
      openingBalance: 0,
      closingBalance: 136_250,
    });
  });

  it('leaves a sale on credit in the customer’s receivable, not in the till', async () => {
    const r = await books();
    const order = await r.servedOrder();
    const invoice = BillResponseSchema.parse(
      (
        await r.admin('POST', `/orders/${order.id}/invoice`, {
          customer: { phone: '9830012345', name: 'Mr Bose' },
        })
      ).json(),
    ).invoices[0]!;
    const paid = await r.admin('POST', `/invoices/${invoice.id}/payments`, {
      payments: [{ method: 'CREDIT', amount: invoice.grandTotal }],
    });
    expect(InvoiceSchema.parse(paid.json()).status).toBe('CREDIT');
    const payments = JournalEntriesResponseSchema.parse(
      (await r.admin('GET', '/journal-entries?sourceType=PAYMENT')).json(),
    ).data;
    expect(payments).toEqual([]);
    const balances = await r.accounts();
    expect([balances.get('1100'), balances.get('1000')]).toEqual([100_800, 0]);
    const party = await r.ok(
      r.admin('GET', `/ledgers/party/CUSTOMER/${invoice.customerId}?from=${TODAY}&to=${TODAY}`),
      PartyLedgerSchema,
    );
    expect(party).toMatchObject({ partyName: 'Mr Bose', closingBalance: 100_800 });
  });

  it('cancelling a bill reverses its journal', async () => {
    const r = await books();
    const order = await r.servedOrder();
    const invoice = BillResponseSchema.parse(
      (await r.cashier('POST', `/orders/${order.id}/invoice`, {})).json(),
    ).invoices[0]!;
    const cancelled = await r.ok(
      r.admin('POST', `/invoices/${invoice.id}/cancel`, {
        version: invoice.version,
        reason: 'Billed the wrong table',
      }),
      InvoiceSchema,
    );
    expect(cancelled.status).toBe('CANCELLED');
    const entries = JournalEntriesResponseSchema.parse(
      (await r.admin('GET', '/journal-entries?sourceType=INVOICE')).json(),
    ).data;
    expect(
      entries.map((e) => [e.narration, e.reversalOfId === null, e.reversedById === null]),
    ).toEqual([
      [`Bill ${invoice.invoiceNo} cancelled`, false, true],
      [`Bill ${invoice.invoiceNo}`, true, false],
    ]);
    const balances = await r.accounts();
    expect([balances.get('1100'), balances.get('4000'), balances.get('2100')]).toEqual([0, 0, 0]);
  });

  it('guards the chart, manual journals and expenses', async () => {
    const { admin, accountant, cashier, ok, byCode } = await books();
    expect((await cashier('GET', '/accounts')).statusCode).toBe(403);

    const meals = await ok(
      admin('POST', '/accounts', { code: '6050', name: 'Staff meals', type: 'EXPENSE' }),
      AccountSchema,
    );
    expect(meals).toMatchObject({ systemTag: null, balance: 0 });
    const dup = await admin('POST', '/accounts', { code: '6050', name: 'Again', type: 'EXPENSE' });
    expect([dup.statusCode, dup.json().code]).toEqual([409, 'ACCOUNT_CODE_TAKEN']);
    const cash = byCode('1000');
    const retire = await admin('PATCH', `/accounts/${encodeURIComponent(cash.id)}`, {
      version: cash.version,
      isActive: false,
    });
    expect([retire.statusCode, retire.json().code]).toEqual([409, 'SYSTEM_ACCOUNT']);

    const lines = [
      { accountId: byCode('1000').id, debit: 10_000 },
      { accountId: byCode('3000').id, credit: 9_000 },
    ];
    const unbalanced = await admin('POST', '/journal-entries', {
      entryDate: TODAY,
      narration: 'Oops',
      lines,
    });
    expect([unbalanced.statusCode, unbalanced.json().code]).toEqual([422, 'JOURNAL_UNBALANCED']);
    const future = await admin('POST', '/journal-entries', {
      entryDate: '2026-10-29',
      narration: 'Tomorrow',
      lines: [lines[0], { ...lines[1], credit: 10_000 }],
    });
    expect(future.json().code).toBe('VALIDATION_FAILED');
    // The accountant reads the books but posts journals only with accounts.journal (they have it).
    const entry = await ok(
      accountant('POST', '/journal-entries', {
        entryDate: TODAY,
        narration: 'Float from the owner',
        lines: [lines[0], { ...lines[1], credit: 10_000 }],
      }),
      JournalEntrySchema,
    );
    const reversal = await ok(
      accountant('POST', `/journal-entries/${entry.id}/reverse`, { reason: 'Posted twice' }),
      JournalEntrySchema,
    );
    expect(reversal).toMatchObject({ reversalOfId: entry.id, narration: 'Reversal: Posted twice' });
    expect(reversal.lines.map((l) => [l.debit, l.credit])).toEqual([
      [0, 10_000],
      [10_000, 0],
    ]);
    const again = await accountant('POST', `/journal-entries/${entry.id}/reverse`, {
      reason: 'Posted twice',
    });
    expect([again.statusCode, again.json().code]).toEqual([409, 'ALREADY_REVERSED']);

    // Expenses go to an expense account from cash or bank; cancelling reverses the entry.
    const wrong = await accountant('POST', '/expenses', {
      expenseAccountId: byCode('1010').id,
      paidFromAccountId: byCode('1000').id,
      amount: 5_000,
      description: 'Not an expense',
    });
    expect(wrong.json().code).toBe('VALIDATION_FAILED');
    const fromStock = await accountant('POST', '/expenses', {
      expenseAccountId: byCode('6000').id,
      paidFromAccountId: byCode('1200').id,
      amount: 5_000,
      description: 'Paid with rice',
    });
    expect(fromStock.json().code).toBe('VALIDATION_FAILED');
    const expense = await ok(
      accountant('POST', '/expenses', {
        expenseAccountId: meals.id,
        paidFromAccountId: byCode('1000').id,
        amount: 25_000,
        description: 'Staff lunch',
      }),
      ExpenseSchema,
    );
    const cancelled = await ok(
      accountant('POST', `/expenses/${expense.id}/cancel`, {
        version: expense.version,
        reason: 'Paid by the owner',
      }),
      ExpenseSchema,
    );
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Paid by the owner' });
    const tb = await ok(accountant('GET', '/reports/trial-balance'), TrialBalanceSchema);
    expect(tb).toMatchObject({ balanced: true, rows: [] });
  });
});
