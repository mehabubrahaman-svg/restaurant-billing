import { z } from 'zod';
import { IdSchema, PaiseSchema, patchSchema } from './common';
import { IndianMobileSchema } from './customers';

const Version = z.number().int();

export const InvoiceStatusSchema = z.enum([
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
  'CREDIT',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;
/** INV: food and drinks (GST). LIQ: liquor billed separately (state VAT). CN: credit note. */
export const InvoiceSeriesSchema = z.enum(['INV', 'LIQ', 'CN']);
export const TaxCodeSchema = z.enum(['CGST', 'SGST', 'IGST', 'VAT', 'SURCHARGE', 'CESS']);

/**
 * Card and UPI are taken on the restaurant's own standalone terminal; the
 * cashier keys in the approval code / UPI RRN (docs/01 §5.9). CREDIT needs a
 * named customer and billing.credit_sale. AGGREGATOR: the aggregator collected.
 */
export const PaymentMethodSchema = z.enum([
  'CASH',
  'CARD',
  'UPI',
  'WALLET',
  'CREDIT',
  'AGGREGATOR',
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const InvoiceLineSchema = z.object({
  id: IdSchema,
  orderItemId: IdSchema.nullable(),
  description: z.string(),
  hsnSacCode: z.string().nullable(),
  quantity: z.number().int(),
  /** Per unit including add-ons, as charged (tax-inclusive when the tax group is). */
  unitPrice: PaiseSchema,
  /** This line's share of bill-level discounts. */
  discount: PaiseSchema,
  taxableValue: PaiseSchema,
  /** Total of the components, e.g. 2.5% CGST + 2.5% SGST = 500. */
  taxRateBp: z.number().int(),
  taxAmount: PaiseSchema,
  /** taxableValue + taxAmount. */
  lineTotal: PaiseSchema,
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

/** Per tax code and rate, as printed: "CGST 2.5% on ₹960.00 = ₹24.00". */
export const InvoiceTaxSchema = z.object({
  code: TaxCodeSchema,
  rateBp: z.number().int(),
  taxableValue: PaiseSchema,
  taxAmount: PaiseSchema,
});

export const InvoiceDiscountSchema = z.object({
  kind: z.enum(['PERCENT', 'FIXED', 'COUPON', 'COMPLIMENTARY']),
  /** Basis points for PERCENT/COUPON-percent, paise for FIXED. */
  value: z.number().int(),
  amount: PaiseSchema,
  couponCode: z.string().nullable(),
  reason: z.string().nullable(),
});

export const InvoiceChargeSchema = z.object({
  chargeRuleId: IdSchema.nullable(),
  name: z.string(),
  /** Before tax. */
  amount: PaiseSchema,
  taxAmount: PaiseSchema,
});

export const PaymentSchema = z.object({
  id: IdSchema,
  method: PaymentMethodSchema,
  /** Negative for refunds. */
  amount: PaiseSchema,
  tendered: PaiseSchema.nullable(),
  changeDue: PaiseSchema.nullable(),
  reference: z.string().nullable(),
  cardLast4: z.string().nullable(),
  terminalLabel: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type Payment = z.infer<typeof PaymentSchema>;

/** What the bill panel shows before anything is saved (POST /orders/{id}/bill-preview). */
export const InvoiceDraftSchema = z.object({
  series: InvoiceSeriesSchema,
  lines: z.array(InvoiceLineSchema.omit({ id: true })),
  taxes: z.array(InvoiceTaxSchema),
  discounts: z.array(InvoiceDiscountSchema),
  charges: z.array(InvoiceChargeSchema),
  /** Sum of line amounts before discount. */
  subtotal: PaiseSchema,
  discountTotal: PaiseSchema,
  chargesTotal: PaiseSchema,
  taxableTotal: PaiseSchema,
  taxTotal: PaiseSchema,
  /** To the branch's cash rounding (₹1 by default); may be negative. */
  roundOff: PaiseSchema,
  grandTotal: PaiseSchema,
});
export type InvoiceDraft = z.infer<typeof InvoiceDraftSchema>;

export const InvoiceSchema = InvoiceDraftSchema.extend({
  id: IdSchema,
  /** Gapless per branch, series and financial year, e.g. "KOL1/2026-27/000123". */
  invoiceNo: z.string(),
  kind: z.enum(['INVOICE', 'CREDIT_NOTE']),
  orderId: IdSchema,
  orderNo: z.string(),
  orderType: z.string(),
  tableLabel: z.string().nullable(),
  tokenNo: z.number().int().nullable(),
  businessDate: z.string(),
  supplyType: z.enum(['B2B', 'B2C']),
  customerId: IdSchema.nullable(),
  customerName: z.string().nullable(),
  customerTaxId: z.string().nullable(),
  gstPaidByOperator: z.boolean(),
  originalInvoiceId: IdSchema.nullable(),
  lines: z.array(InvoiceLineSchema),
  paidTotal: PaiseSchema,
  /** grandTotal − paidTotal. */
  balance: PaiseSchema,
  status: InvoiceStatusSchema,
  payments: z.array(PaymentSchema),
  printCount: z.number().int(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  version: Version,
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const InvoiceSummarySchema = InvoiceSchema.pick({
  id: true,
  invoiceNo: true,
  kind: true,
  series: true,
  orderId: true,
  orderNo: true,
  orderType: true,
  tableLabel: true,
  tokenNo: true,
  businessDate: true,
  grandTotal: true,
  paidTotal: true,
  balance: true,
  status: true,
  createdAt: true,
  version: true,
});
export type InvoiceSummary = z.infer<typeof InvoiceSummarySchema>;
export const InvoicesResponseSchema = z.object({ data: z.array(InvoiceSummarySchema) });
export type InvoicesResponse = z.infer<typeof InvoicesResponseSchema>;

// ---- billing an order ------------------------------------------------------------------
/**
 * Discounts: up to the branch limit (default 10%) with billing.discount; above
 * it billing.discount_override or a manager's approval. COMPLIMENTARY (the
 * whole bill free) needs billing.complimentary or approval. Optional charges
 * (service charge) apply unless listed in `removeChargeRuleIds`.
 */
export const BillRequestSchema = z.object({
  discount: z
    .object({
      kind: z.enum(['PERCENT', 'FIXED']),
      /** Basis points (1000 = 10%) or paise. */
      value: z.number().int().positive(),
      reason: z.string().trim().max(120).optional(),
    })
    .optional(),
  couponCode: z.string().trim().toUpperCase().max(32).optional(),
  complimentary: z.object({ reason: z.string().trim().min(3).max(120) }).optional(),
  removeChargeRuleIds: z.array(IdSchema).max(10).default([]),
  /**
   * The guest, found or added by mobile number (their visits and spend are
   * tracked). B2B: their GSTIN is printed on the tax invoice.
   */
  customer: z
    .object({
      phone: IndianMobileSchema.optional(),
      name: z.string().trim().min(1).max(120).optional(),
      taxId: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'a 15-character GSTIN')
        .optional(),
    })
    .optional(),
});
export type BillRequest = z.input<typeof BillRequestSchema>;
export const BillPreviewResponseSchema = z.object({ invoices: z.array(InvoiceDraftSchema) });
export type BillPreviewResponse = z.infer<typeof BillPreviewResponseSchema>;
/** One invoice, or two when liquor is billed separately (INV + LIQ). */
export const BillResponseSchema = z.object({ invoices: z.array(InvoiceSchema) });
export type BillResponse = z.infer<typeof BillResponseSchema>;

export const NewPaymentSchema = z
  .object({
    method: PaymentMethodSchema,
    amount: PaiseSchema.positive(),
    /** Cash: what the guest handed over; change = tendered − amount. */
    tendered: PaiseSchema.positive().optional(),
    reference: z.string().trim().min(2).max(40).optional(),
    cardLast4: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    terminalLabel: z.string().trim().max(40).optional(),
  })
  .refine((p) => p.tendered === undefined || (p.method === 'CASH' && p.tendered >= p.amount), {
    message: 'tendered is for cash and must cover the amount',
    path: ['tendered'],
  });
/** Split payment = several entries. The total may not exceed the balance. */
export const RecordPaymentsRequestSchema = z.object({
  payments: z.array(NewPaymentSchema).min(1).max(10),
});

/** Unpaid: the order reopens. Paid in the current shift: payments are refunded the same way. */
export const CancelInvoiceRequestSchema = z.object({
  version: Version,
  reason: z.string().trim().min(3).max(200),
});

/** A credit note for some lines (by quantity) or a flat amount, refunded by `method`. */
export const RefundRequestSchema = z
  .object({
    lines: z
      .array(z.object({ invoiceLineId: IdSchema, quantity: z.number().int().positive() }))
      .max(100)
      .optional(),
    amount: PaiseSchema.positive().optional(),
    method: PaymentMethodSchema.exclude(['CREDIT', 'AGGREGATOR']),
    reference: z.string().trim().max(40).optional(),
    reason: z.string().trim().min(3).max(200),
  })
  .refine((r) => (r.lines === undefined) !== (r.amount === undefined), {
    message: 'refund either lines or an amount',
  });
export const RefundResponseSchema = z.object({ creditNote: InvoiceSchema, invoice: InvoiceSchema });

// ---- cash shifts ---------------------------------------------------------------------------
export const OpenShiftRequestSchema = z.object({ openingFloat: PaiseSchema.nonnegative() });

export const TenderLineSchema = z.object({
  method: PaymentMethodSchema,
  terminalLabel: z.string(),
  expected: PaiseSchema,
  reported: PaiseSchema.nullable(),
  variance: PaiseSchema.nullable(),
});

/** X report while open, Z report once closed. */
export const ShiftReportSchema = z.object({
  id: IdSchema,
  status: z.enum(['OPEN', 'CLOSED']),
  openedAt: z.string(),
  openedByName: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedByName: z.string().nullable(),
  openingFloat: PaiseSchema,
  /** Opening float + cash taken − cash refunded. */
  expectedCash: PaiseSchema,
  countedCash: PaiseSchema.nullable(),
  cashVariance: PaiseSchema.nullable(),
  invoiceCount: z.number().int(),
  sales: PaiseSchema,
  refunds: PaiseSchema,
  tenders: z.array(TenderLineSchema),
  version: Version,
});
export type ShiftReport = z.infer<typeof ShiftReportSchema>;

export const CloseShiftRequestSchema = z.object({
  version: Version,
  countedCash: PaiseSchema.nonnegative(),
  /** Note/coin value in rupees → count, e.g. {"500": 3, "10": 12}. Kept for the record. */
  denominations: z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative()).optional(),
  /** Each card/UPI terminal's settlement total, from its batch report. */
  tenders: z
    .array(
      z.object({
        method: PaymentMethodSchema,
        terminalLabel: z.string().trim().max(40).default(''),
        reportedAmount: PaiseSchema,
      }),
    )
    .max(20)
    .default([]),
  notes: z.string().trim().max(500).optional(),
});

// ---- coupons (Settings → Coupons, settings.manage) ---------------------------------------------
export const CouponSchema = z.object({
  id: IdSchema,
  code: z.string(),
  kind: z.enum(['PERCENT', 'FIXED']),
  /** Basis points or paise. */
  value: z.number().int(),
  maxDiscount: PaiseSchema.nullable(),
  minBill: PaiseSchema,
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  usageLimit: z.number().int().nullable(),
  usedCount: z.number().int(),
  isActive: z.boolean(),
  version: Version,
});
export type Coupon = z.infer<typeof CouponSchema>;
export const CouponsResponseSchema = z.object({ data: z.array(CouponSchema) });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const SaveCouponRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,32}$/),
  kind: z.enum(['PERCENT', 'FIXED']),
  value: z.number().int().positive(),
  maxDiscount: PaiseSchema.positive().nullable().default(null),
  minBill: PaiseSchema.nonnegative().default(0),
  validFrom: Day.nullable().default(null),
  validTo: Day.nullable().default(null),
  usageLimit: z.number().int().positive().nullable().default(null),
});
export const UpdateCouponRequestSchema = patchSchema(SaveCouponRequestSchema).extend({
  version: Version,
  isActive: z.boolean().optional(),
});
