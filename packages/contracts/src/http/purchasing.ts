import { z } from 'zod';
import {
  CalendarDateSchema,
  BasisPointsSchema,
  IdSchema,
  PaiseSchema,
  patchSchema,
} from './common';
import { BaseUnitSchema } from './inventory';

/**
 * Purchasing (docs/08 Phase 3): vendors, purchase orders with approval, goods
 * received notes that put stock on the shelves, vendor payments and dues.
 * Quantities on POs and GRNs are milli-units of the line's purchase unit
 * (2.5 kg = 2_500 when the unit is kg); prices are paise per purchase unit.
 */
const Version = z.number().int();
const Day = CalendarDateSchema;
const Text = (max: number) => z.string().trim().min(1).max(max);
const GstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'a 15-character GSTIN');
/** Up to 10 000 units on one line. */
const QuantityMilli = z.number().int().positive().max(10_000_000);
/** GST slabs go up to 28%. */
const TaxRate = BasisPointsSchema.max(2_800);

// ---- vendors ------------------------------------------------------------------------
export const VendorSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  contactPerson: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  /** GSTIN; null for an unregistered vendor (no input tax credit). */
  taxId: z.string().nullable(),
  /** Days after the bill date that it falls due. */
  paymentTermsDays: z.number().int(),
  /** Posted GRNs minus payments, paise; negative is an advance. */
  due: PaiseSchema,
  isActive: z.boolean(),
  version: Version,
});
export type Vendor = z.infer<typeof VendorSchema>;
export const VendorsResponseSchema = z.object({ data: z.array(VendorSchema) });
export type VendorsResponse = z.infer<typeof VendorsResponseSchema>;

export const SaveVendorRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'up to 20 letters, digits, - or _'),
  name: Text(120),
  contactPerson: Text(120).nullable().default(null),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{5,19}$/, 'a phone number')
    .nullable()
    .default(null),
  email: z.email().nullable().default(null),
  address: Text(300).nullable().default(null),
  taxId: GstinSchema.nullable().default(null),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
});
export type SaveVendorRequest = z.input<typeof SaveVendorRequestSchema>;
/** `isActive: false` retires the vendor (no new POs or GRNs; history stays). */
export const UpdateVendorRequestSchema = patchSchema(SaveVendorRequestSchema).extend({
  version: Version,
  isActive: z.boolean().optional(),
});

// ---- purchase orders ------------------------------------------------------------------
export const PurchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusSchema>;

const LineAmounts = {
  /** quantity × unitPrice, paise. */
  value: PaiseSchema,
  taxAmount: PaiseSchema,
  total: PaiseSchema,
};

export const PurchaseOrderLineSchema = z.object({
  id: IdSchema,
  inventoryItemId: IdSchema,
  itemName: z.string(),
  baseUnit: BaseUnitSchema,
  unitId: z.string(),
  unitCode: z.string(),
  quantityMilli: z.number().int(),
  /** Paise per purchase unit, before tax. */
  unitPrice: PaiseSchema,
  taxRateBp: z.number().int(),
  ...LineAmounts,
  /** Accepted on posted GRNs so far, in the line's unit. */
  receivedQtyMilli: z.number().int(),
});

export const PurchaseOrderSummarySchema = z.object({
  id: IdSchema,
  /** Per branch and financial year, e.g. "KOL1/PO/2026-27/000012". */
  poNo: z.string(),
  vendorId: IdSchema,
  vendorName: z.string(),
  status: PurchaseOrderStatusSchema,
  expectedOn: z.string().nullable(),
  subtotal: PaiseSchema,
  taxTotal: PaiseSchema,
  grandTotal: PaiseSchema,
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  version: Version,
});
export type PurchaseOrderSummary = z.infer<typeof PurchaseOrderSummarySchema>;
export const PurchaseOrdersResponseSchema = z.object({ data: z.array(PurchaseOrderSummarySchema) });

export const PurchaseOrderSchema = PurchaseOrderSummarySchema.extend({
  notes: z.string().nullable(),
  lines: z.array(PurchaseOrderLineSchema),
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  sentAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /** GRNs against this PO, posted or draft. */
  grns: z.array(
    z.object({ id: IdSchema, grnNo: z.string(), status: z.string(), grandTotal: PaiseSchema }),
  ),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

const PoLineInput = z.object({
  inventoryItemId: IdSchema,
  /** Its base must be the item's base unit (kg or g for an item kept in g). */
  unitId: z.string().min(1).max(40),
  quantityMilli: QuantityMilli,
  unitPrice: PaiseSchema.nonnegative(),
  taxRateBp: TaxRate.default(0),
});
export const SavePurchaseOrderRequestSchema = z.object({
  vendorId: IdSchema,
  expectedOn: Day.nullable().default(null),
  notes: z.string().trim().max(500).nullable().default(null),
  lines: z.array(PoLineInput).min(1).max(100),
});
export type SavePurchaseOrderRequest = z.input<typeof SavePurchaseOrderRequestSchema>;
/** Only a DRAFT can be edited; `lines` replaces them all. */
export const UpdatePurchaseOrderRequestSchema = z.object({
  version: Version,
  vendorId: IdSchema.optional(),
  expectedOn: Day.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  lines: z.array(PoLineInput).min(1).max(100).optional(),
});
export const PurchaseOrderActionRequestSchema = z.object({ version: Version });
export const CancelPurchaseOrderRequestSchema = z.object({
  version: Version,
  reason: Text(200),
});

// ---- goods received notes ---------------------------------------------------------------
export const GrnStatusSchema = z.enum(['DRAFT', 'POSTED', 'CANCELLED']);
export const InputTaxKindSchema = z.enum(['CGST_SGST', 'IGST', 'NONE']);

export const GrnLineSchema = z.object({
  id: IdSchema,
  purchaseOrderLineId: IdSchema.nullable(),
  inventoryItemId: IdSchema,
  itemName: z.string(),
  baseUnit: BaseUnitSchema,
  unitId: z.string(),
  unitCode: z.string(),
  /** Delivered, in the line's unit. */
  quantityMilli: z.number().int(),
  /** Sent back at the door (damaged, short weight); not paid for, not stocked. */
  rejectedQtyMilli: z.number().int(),
  acceptedQtyMilli: z.number().int(),
  unitPrice: PaiseSchema,
  taxRateBp: z.number().int(),
  /** On the accepted quantity. */
  ...LineAmounts,
  batchNo: z.string().nullable(),
  expiresOn: z.string().nullable(),
});

export const GrnSummarySchema = z.object({
  id: IdSchema,
  /** e.g. "KOL1/GRN/2026-27/000031". */
  grnNo: z.string(),
  vendorId: IdSchema,
  vendorName: z.string(),
  purchaseOrderId: IdSchema.nullable(),
  poNo: z.string().nullable(),
  vendorInvoiceNo: z.string().nullable(),
  vendorInvoiceDate: z.string().nullable(),
  businessDate: z.string(),
  /** Set when posted: bill date + the vendor's terms. */
  dueOn: z.string().nullable(),
  status: GrnStatusSchema,
  subtotal: PaiseSchema,
  taxTotal: PaiseSchema,
  grandTotal: PaiseSchema,
  /** Paid against this GRN (on-account payments are not included). */
  paid: PaiseSchema,
  balance: PaiseSchema,
  version: Version,
});
export type GrnSummary = z.infer<typeof GrnSummarySchema>;
export const GrnsResponseSchema = z.object({ data: z.array(GrnSummarySchema) });

export const GrnSchema = GrnSummarySchema.extend({
  inputTaxKind: InputTaxKindSchema,
  notes: z.string().nullable(),
  lines: z.array(GrnLineSchema),
  cancelReason: z.string().nullable(),
  postedAt: z.string().nullable(),
  postedByName: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type Grn = z.infer<typeof GrnSchema>;

const GrnLineInput = z.object({
  /** The PO line received; its item and unit must match. */
  purchaseOrderLineId: IdSchema.nullable().default(null),
  inventoryItemId: IdSchema,
  unitId: z.string().min(1).max(40),
  quantityMilli: QuantityMilli,
  rejectedQtyMilli: z.number().int().nonnegative().max(10_000_000).default(0),
  unitPrice: PaiseSchema.nonnegative(),
  taxRateBp: TaxRate.default(0),
  batchNo: z.string().trim().min(1).max(40).nullable().default(null),
  expiresOn: Day.nullable().default(null),
});
/** Against a PO (its vendor is used) or direct from a vendor. */
export const SaveGrnRequestSchema = z.object({
  purchaseOrderId: IdSchema.nullable().default(null),
  vendorId: IdSchema.nullable().default(null),
  vendorInvoiceNo: z.string().trim().min(1).max(40).nullable().default(null),
  vendorInvoiceDate: Day.nullable().default(null),
  notes: z.string().trim().max(500).nullable().default(null),
  lines: z.array(GrnLineInput).min(1).max(100),
});
export type SaveGrnRequest = z.input<typeof SaveGrnRequestSchema>;
/** Only a DRAFT can be edited; `lines` replaces them all. */
export const UpdateGrnRequestSchema = z.object({
  version: Version,
  vendorInvoiceNo: z.string().trim().min(1).max(40).nullable().optional(),
  vendorInvoiceDate: Day.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  lines: z.array(GrnLineInput).min(1).max(100).optional(),
});
/** Puts the accepted goods into stock (PURCHASE movements, batches) and the bill into the vendor's dues. */
export const PostGrnRequestSchema = z.object({ version: Version });
export const CancelGrnRequestSchema = z.object({ version: Version, reason: Text(200) });

// ---- vendor payments --------------------------------------------------------------------
export const VendorPaymentMethodSchema = z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE']);
export type VendorPaymentMethod = z.infer<typeof VendorPaymentMethodSchema>;

export const VendorPaymentSchema = z.object({
  id: IdSchema,
  vendorId: IdSchema,
  vendorName: z.string(),
  /** null: on account, settles the oldest bills first. */
  grnId: IdSchema.nullable(),
  grnNo: z.string().nullable(),
  method: VendorPaymentMethodSchema,
  amount: PaiseSchema,
  /** Cheque number, UTR, UPI reference. */
  reference: z.string().nullable(),
  paidOn: z.string(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type VendorPayment = z.infer<typeof VendorPaymentSchema>;
export const VendorPaymentsResponseSchema = z.object({ data: z.array(VendorPaymentSchema) });

/** Payments are never edited; a mistake is corrected with the vendor (a refund is Phase 4 accounting). */
export const RecordVendorPaymentRequestSchema = z.object({
  vendorId: IdSchema,
  grnId: IdSchema.nullable().default(null),
  method: VendorPaymentMethodSchema,
  amount: PaiseSchema.positive(),
  reference: z.string().trim().min(1).max(60).nullable().default(null),
  /** Defaults to today's business day. */
  paidOn: Day.optional(),
});

// ---- statements and dues ----------------------------------------------------------------
export const VendorStatementSchema = z.object({
  vendor: VendorSchema,
  from: z.string(),
  to: z.string(),
  /** Owed at the start of `from` (negative: an advance). */
  openingBalance: PaiseSchema,
  entries: z.array(
    z.object({
      date: z.string(),
      kind: z.enum(['BILL', 'PAYMENT']),
      /** The GRN or the payment. */
      id: IdSchema,
      number: z.string().nullable(),
      description: z.string(),
      /** Payments made. */
      debit: PaiseSchema,
      /** Bills (posted GRNs). */
      credit: PaiseSchema,
      balance: PaiseSchema,
    }),
  ),
  closingBalance: PaiseSchema,
});
export type VendorStatement = z.infer<typeof VendorStatementSchema>;

const Buckets = {
  /** Not yet due. */
  current: PaiseSchema,
  d1to30: PaiseSchema,
  d31to60: PaiseSchema,
  d61to90: PaiseSchema,
  over90: PaiseSchema,
};
/** What is owed to each vendor, by how long past due (on-account payments settle the oldest bills). */
export const VendorDuesReportSchema = z.object({
  asOf: z.string(),
  rows: z.array(
    z.object({
      vendorId: IdSchema,
      code: z.string(),
      name: z.string(),
      billed: PaiseSchema,
      paid: PaiseSchema,
      due: PaiseSchema,
      advance: PaiseSchema,
      ...Buckets,
      oldestDueOn: z.string().nullable(),
    }),
  ),
  totals: z.object({ due: PaiseSchema, advance: PaiseSchema, ...Buckets }),
});
export type VendorDuesReport = z.infer<typeof VendorDuesReportSchema>;
