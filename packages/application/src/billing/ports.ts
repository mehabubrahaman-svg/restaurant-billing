import type { Invoice, NewPayment, PaymentMethod } from '@restroos/domain';

export interface InvoiceRepository {
  get(branchId: string, id: string): Invoice | undefined;
  /** Tax invoices of an order (not credit notes), oldest first. */
  forOrder(orderId: string): Invoice[];
  /** Credit-note line quantities already refunded per original line, and whether any flat-amount refund exists. */
  refundedSoFar(invoiceId: string): { quantities: Map<string, number>; anyAmountRefunds: boolean };
  /** Payments taken on an invoice (not refunds), for reversing them on cancel. */
  paymentsOf(invoiceId: string): NewPayment[];
  insert(invoice: Invoice): void;
  /** Version-checked; appends the invoice's new payments. */
  save(invoice: Invoice): void;
  /**
   * The next gapless number for a branch, series and financial year, e.g.
   * "KOL1/2026-27/000123". Called inside the invoice's transaction.
   */
  nextNumber(
    branchId: string,
    series: 'INV' | 'LIQ' | 'CN',
    fiscalYear: string,
    branchCode: string,
  ): string;
}

export interface CouponRecord {
  id: string;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  maxDiscount: number | null;
  minBill: number;
  validFrom: string | null;
  validTo: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
}

export interface CouponRepository {
  byCode(code: string): CouponRecord | undefined;
  markUsed(id: string, at: Date): void;
  all(): (CouponRecord & { version: number })[];
  get(id: string): (CouponRecord & { version: number }) | undefined;
  insert(record: CouponRecord & { version: number }, at: Date): void;
  /** Version-checked. */
  update(record: CouponRecord & { version: number }, at: Date): void;
}

export interface ShiftRecord {
  id: string;
  branchId: string;
  deviceId: string | null;
  openedBy: string;
  openedAt: Date;
  openingFloat: number;
  status: 'OPEN' | 'CLOSED';
  version: number;
}

export interface TenderCount {
  method: PaymentMethod;
  terminalLabel: string;
  expected: number;
  reported: number;
}

export interface ShiftRepository {
  /** The open shift of a device, or of a user at a browser that isn't a paired device. */
  openFor(branchId: string, deviceId: string | null, userId: string): ShiftRecord | undefined;
  get(branchId: string, id: string): ShiftRecord | undefined;
  insert(record: ShiftRecord): void;
  close(
    id: string,
    expectedVersion: number,
    input: {
      closedBy: string;
      closedAt: Date;
      expectedCash: number;
      countedCash: number;
      denominations: Record<string, number> | null;
      notes: string | null;
      tenders: readonly TenderCount[];
    },
  ): void;
  /** Net payments in the shift per method and terminal (refunds negative). */
  tenderTotals(shiftId: string): { method: PaymentMethod; terminalLabel: string; amount: number }[];
}

// ---- read models (shapes match packages/contracts billing.ts) ------------------------------
export interface InvoiceView {
  id: string;
  invoiceNo: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  series: 'INV' | 'LIQ' | 'CN';
  orderId: string;
  orderNo: string;
  orderType: string;
  tableLabel: string | null;
  tokenNo: number | null;
  businessDate: string;
  supplyType: 'B2B' | 'B2C';
  customerId: string | null;
  customerName: string | null;
  customerTaxId: string | null;
  gstPaidByOperator: boolean;
  originalInvoiceId: string | null;
  lines: {
    id: string;
    orderItemId: string | null;
    description: string;
    hsnSacCode: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxableValue: number;
    taxRateBp: number;
    taxAmount: number;
    lineTotal: number;
  }[];
  taxes: {
    code: 'CGST' | 'SGST' | 'IGST' | 'VAT' | 'SURCHARGE' | 'CESS';
    rateBp: number;
    taxableValue: number;
    taxAmount: number;
  }[];
  discounts: {
    kind: 'PERCENT' | 'FIXED' | 'COUPON' | 'LOYALTY' | 'COMPLIMENTARY';
    value: number;
    amount: number;
    couponCode: string | null;
    reason: string | null;
  }[];
  charges: { chargeRuleId: string | null; name: string; amount: number; taxAmount: number }[];
  subtotal: number;
  discountTotal: number;
  chargesTotal: number;
  taxableTotal: number;
  taxTotal: number;
  roundOff: number;
  grandTotal: number;
  paidTotal: number;
  balance: number;
  status:
    | 'UNPAID'
    | 'PARTIALLY_PAID'
    | 'PAID'
    | 'CREDIT'
    | 'CANCELLED'
    | 'REFUNDED'
    | 'PARTIALLY_REFUNDED';
  payments: {
    id: string;
    method: PaymentMethod;
    amount: number;
    tendered: number | null;
    changeDue: number | null;
    reference: string | null;
    cardLast4: string | null;
    terminalLabel: string | null;
    createdAt: string;
    createdByName: string | null;
  }[];
  printCount: number;
  cancelReason: string | null;
  createdAt: string;
  createdByName: string | null;
  version: number;
}

export type InvoiceSummaryView = Pick<
  InvoiceView,
  | 'id'
  | 'invoiceNo'
  | 'kind'
  | 'series'
  | 'orderId'
  | 'orderNo'
  | 'orderType'
  | 'tableLabel'
  | 'tokenNo'
  | 'businessDate'
  | 'grandTotal'
  | 'paidTotal'
  | 'balance'
  | 'status'
  | 'createdAt'
  | 'version'
>;

export interface ShiftReportView {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  openingFloat: number;
  expectedCash: number;
  countedCash: number | null;
  cashVariance: number | null;
  invoiceCount: number;
  sales: number;
  refunds: number;
  tenders: {
    method: PaymentMethod;
    terminalLabel: string;
    expected: number;
    reported: number | null;
    variance: number | null;
  }[];
  version: number;
}

export interface BillingQueries {
  invoice(branchId: string, id: string): InvoiceView | undefined;
  forOrder(branchId: string, orderId: string): InvoiceView[];
  /** Credit notes issued against an invoice, oldest first, on any business day. */
  creditNotes(branchId: string, invoiceId: string): InvoiceView[];
  list(branchId: string, businessDate: string, status?: string): InvoiceSummaryView[];
  summary(branchId: string, id: string): InvoiceSummaryView | undefined;
  shiftReport(branchId: string, id: string): ShiftReportView | undefined;
}
