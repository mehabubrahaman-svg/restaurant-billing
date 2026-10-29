import type {
  Invoice,
  InvoiceDraft,
  InvoiceSummary,
  Payment,
  ShiftReport,
} from '@restroos/contracts';
import { ORDER_ID, OPENED_AT } from './order-fixtures';

export const INVOICE_ID = '0d000000-0000-4000-8000-000000000001';
export const LIQ_INVOICE_ID = '0d000000-0000-4000-8000-000000000002';
export const CN_ID = '0d000000-0000-4000-8000-000000000003';
export const INV_LINE_1 = '0e000000-0000-4000-8000-000000000001';
export const INV_LINE_2 = '0e000000-0000-4000-8000-000000000002';
export const SHIFT_ID = '0f000000-0000-4000-8000-000000000001';
export const SERVICE_RULE = '0f100000-0000-4000-8000-000000000001';
export const ITEM_A = '0b000000-0000-4000-8000-000000000001';
export const ITEM_B = '0b000000-0000-4000-8000-000000000002';

/**
 * A GST bill like wireframes §7: Biryani 2 × ₹320 + Naan 4 × ₹60 = ₹880,
 * optional 5% service charge, 2.5% + 2.5% GST, rounded to the rupee.
 */
export function makeDraft(overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    series: 'INV',
    lines: [
      {
        orderItemId: ITEM_A,
        description: 'Chicken Biryani (Full)',
        hsnSacCode: '996331',
        quantity: 2,
        unitPrice: 32000,
        discount: 0,
        taxableValue: 64000,
        taxRateBp: 500,
        taxAmount: 3200,
        lineTotal: 67200,
      },
      {
        orderItemId: ITEM_B,
        description: 'Butter Naan',
        hsnSacCode: '996331',
        quantity: 4,
        unitPrice: 6000,
        discount: 0,
        taxableValue: 24000,
        taxRateBp: 500,
        taxAmount: 1200,
        lineTotal: 25200,
      },
    ],
    taxes: [
      { code: 'CGST', rateBp: 250, taxableValue: 92400, taxAmount: 2310 },
      { code: 'SGST', rateBp: 250, taxableValue: 92400, taxAmount: 2310 },
    ],
    discounts: [],
    charges: [{ chargeRuleId: SERVICE_RULE, name: 'Service charge', amount: 4400, taxAmount: 220 }],
    subtotal: 88000,
    discountTotal: 0,
    chargesTotal: 4400,
    taxableTotal: 92400,
    taxTotal: 4620,
    roundOff: -20,
    grandTotal: 97000,
    ...overrides,
  };
}

export const liquorDraft = (): InvoiceDraft => ({
  series: 'LIQ',
  lines: [
    {
      orderItemId: ITEM_B,
      description: 'Whisky 60 ml',
      hsnSacCode: null,
      quantity: 2,
      unitPrice: 35000,
      discount: 0,
      taxableValue: 70000,
      taxRateBp: 2000,
      taxAmount: 14000,
      lineTotal: 84000,
    },
  ],
  taxes: [{ code: 'VAT', rateBp: 2000, taxableValue: 70000, taxAmount: 14000 }],
  discounts: [],
  charges: [],
  subtotal: 70000,
  discountTotal: 0,
  chargesTotal: 0,
  taxableTotal: 70000,
  taxTotal: 14000,
  roundOff: 0,
  grandTotal: 84000,
});

export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const draft = makeDraft();
  const grandTotal = overrides.grandTotal ?? draft.grandTotal;
  const paidTotal = overrides.paidTotal ?? 0;
  return {
    ...draft,
    lines: draft.lines.map((l, i) => ({ ...l, id: i === 0 ? INV_LINE_1 : INV_LINE_2 })),
    id: INVOICE_ID,
    invoiceNo: 'KOL1/2026-27/000123',
    kind: 'INVOICE',
    orderId: ORDER_ID,
    orderNo: '142',
    orderType: 'DINE_IN',
    tableLabel: 'T1',
    tokenNo: null,
    businessDate: '2026-10-28',
    supplyType: 'B2C',
    customerId: null,
    customerName: null,
    customerTaxId: null,
    gstPaidByOperator: false,
    originalInvoiceId: null,
    paidTotal,
    balance: grandTotal - paidTotal,
    status: 'UNPAID',
    payments: [],
    printCount: 0,
    cancelReason: null,
    createdAt: OPENED_AT,
    createdByName: 'Ravi Kumar',
    version: 1,
    ...overrides,
    grandTotal,
  } as Invoice;
}

export function summaryOfInvoice(i: Invoice): InvoiceSummary {
  return {
    id: i.id,
    invoiceNo: i.invoiceNo,
    kind: i.kind,
    series: i.series,
    orderId: i.orderId,
    orderNo: i.orderNo,
    orderType: i.orderType,
    tableLabel: i.tableLabel,
    tokenNo: i.tokenNo,
    businessDate: i.businessDate,
    grandTotal: i.grandTotal,
    paidTotal: i.paidTotal,
    balance: i.balance,
    status: i.status,
    createdAt: i.createdAt,
    version: i.version,
  };
}

export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '0c100000-0000-4000-8000-000000000001',
    method: 'CASH',
    amount: 97000,
    tendered: null,
    changeDue: null,
    reference: null,
    cardLast4: null,
    terminalLabel: null,
    createdAt: OPENED_AT,
    createdByName: 'Ravi Kumar',
    ...overrides,
  };
}

export function makeShift(overrides: Partial<ShiftReport> = {}): ShiftReport {
  return {
    id: SHIFT_ID,
    status: 'OPEN',
    openedAt: OPENED_AT,
    openedByName: 'Ravi Kumar',
    closedAt: null,
    closedByName: null,
    openingFloat: 2_00_000,
    expectedCash: 5_00_000,
    countedCash: null,
    cashVariance: null,
    invoiceCount: 4,
    sales: 6_20_000,
    refunds: 0,
    tenders: [
      { method: 'CASH', terminalLabel: '', expected: 5_00_000, reported: null, variance: null },
      {
        method: 'CARD',
        terminalLabel: 'HDFC-1',
        expected: 1_20_000,
        reported: null,
        variance: null,
      },
    ],
    version: 3,
    ...overrides,
  };
}

export const branchSettings = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'KOL1',
  name: 'Park Street',
  address: null,
  phone: null,
  stateCode: '19',
  stateName: 'West Bengal',
  gstin: null,
  vatTin: null,
  exciseLicenceNo: null,
  liquorEnabled: true,
  liquorInvoice: 'SEPARATE' as const,
  cashRounding: 100,
  discountLimitBp: 1000,
  defaultLocale: 'en-IN' as const,
  receiptLanguages: ['en' as const],
  receiptHeader: '',
  receiptFooter: '',
  dayStartsAt: '04:00',
  loyaltyEnabled: false,
  loyaltyEarnPer100: 1,
  loyaltyPointValue: 100,
  loyaltyMinRedeem: 50,
  version: 1,
};

export const serviceChargeRule = {
  id: SERVICE_RULE,
  name: 'Service charge',
  kind: 'PERCENT' as const,
  value: 500,
  orderTypes: ['DINE_IN' as const],
  taxGroupId: null,
  isOptional: true,
  isActive: true,
  version: 1,
};
