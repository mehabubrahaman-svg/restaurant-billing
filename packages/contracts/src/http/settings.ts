import { z } from 'zod';
import {
  BasisPointsSchema,
  IdSchema,
  LocaleSchema,
  PaiseSchema,
  ReceiptLanguageSchema,
} from './common';
import { GstinSchema } from './setup';

export const BranchSettingsSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  stateCode: z.string(),
  stateName: z.string(),
  gstin: z.string().nullable(),
  vatTin: z.string().nullable(),
  exciseLicenceNo: z.string().nullable(),
  liquorEnabled: z.boolean(),
  liquorInvoice: z.enum(['SAME', 'SEPARATE']),
  /** Bill total rounding, in paise: 100 = nearest rupee, 1 = no rounding. */
  cashRounding: PaiseSchema.positive(),
  /** Largest bill discount, in basis points, staff with billing.discount may give without a manager. */
  discountLimitBp: z.number().int(),
  defaultLocale: LocaleSchema,
  receiptLanguages: z.array(ReceiptLanguageSchema),
  receiptHeader: z.string(),
  receiptFooter: z.string(),
  /** Local time the trading day rolls over, "HH:MM". */
  dayStartsAt: z.string(),
  version: z.number().int(),
});
export type BranchSettings = z.infer<typeof BranchSettingsSchema>;

export const UpdateBranchSettingsRequestSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().max(400).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  gstin: GstinSchema.nullable().optional(),
  vatTin: z.string().trim().max(20).nullable().optional(),
  exciseLicenceNo: z.string().trim().max(40).nullable().optional(),
  liquorInvoice: z.enum(['SAME', 'SEPARATE']).optional(),
  cashRounding: z.union([z.literal(1), z.literal(50), z.literal(100)]).optional(),
  discountLimitBp: z.number().int().min(0).max(10_000).optional(),
  defaultLocale: LocaleSchema.optional(),
  receiptLanguages: z.array(ReceiptLanguageSchema).min(1).max(2).optional(),
  receiptHeader: z.string().max(500).optional(),
  receiptFooter: z.string().max(500).optional(),
  dayStartsAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});
export type UpdateBranchSettingsRequest = z.infer<typeof UpdateBranchSettingsRequestSchema>;

export const TaxTypeSchema = z.enum(['GST', 'VAT', 'NONE']);
export const TaxCategorySchema = z.enum(['TAXABLE', 'NIL_RATED', 'EXEMPT', 'NON_GST']);

export const TaxComponentSchema = z.object({
  code: z.enum(['CGST', 'SGST', 'IGST', 'VAT', 'SURCHARGE', 'CESS']),
  rateBp: BasisPointsSchema,
  appliesTo: z.enum(['ALWAYS', 'INTRA_STATE', 'INTER_STATE']),
});
export type TaxComponent = z.infer<typeof TaxComponentSchema>;

export const TaxGroupSchema = z.object({
  id: IdSchema,
  name: z.string(),
  taxType: TaxTypeSchema,
  taxCategory: TaxCategorySchema,
  invoiceSeries: z.string(),
  isInclusive: z.boolean(),
  components: z.array(TaxComponentSchema),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type TaxGroup = z.infer<typeof TaxGroupSchema>;
export const TaxGroupsResponseSchema = z.object({ data: z.array(TaxGroupSchema) });
export type TaxGroupsResponse = z.infer<typeof TaxGroupsResponseSchema>;

export const SaveTaxGroupRequestSchema = z.object({
  name: z.string().trim().min(2).max(60),
  taxType: TaxTypeSchema,
  taxCategory: TaxCategorySchema.default('TAXABLE'),
  invoiceSeries: z.enum(['INV', 'LIQ']).default('INV'),
  isInclusive: z.boolean().default(false),
  components: z.array(TaxComponentSchema).max(6),
});
export const UpdateTaxGroupRequestSchema = SaveTaxGroupRequestSchema.partial().extend({
  version: z.number().int(),
  isActive: z.boolean().optional(),
});

export const OrderTypeSchema = z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'QR_SELF', 'KIOSK']);
export const ChargeRuleSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: z.enum(['PERCENT', 'FIXED']),
  /** Basis points for PERCENT, paise for FIXED. */
  value: z.number().int().nonnegative(),
  orderTypes: z.array(OrderTypeSchema),
  taxGroupId: IdSchema.nullable(),
  isOptional: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type ChargeRule = z.infer<typeof ChargeRuleSchema>;
export const ChargeRulesResponseSchema = z.object({ data: z.array(ChargeRuleSchema) });
export type ChargeRulesResponse = z.infer<typeof ChargeRulesResponseSchema>;
export const SaveChargeRuleRequestSchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(['PERCENT', 'FIXED']),
  value: z.number().int().nonnegative(),
  orderTypes: z.array(OrderTypeSchema).min(1),
  taxGroupId: IdSchema.nullable().default(null),
  isOptional: z.boolean().default(true),
});
export const UpdateChargeRuleRequestSchema = SaveChargeRuleRequestSchema.partial().extend({
  version: z.number().int(),
  isActive: z.boolean().optional(),
});

export const PrinterSchema = z.object({
  id: IdSchema,
  name: z.string(),
  connection: z.enum(['USB', 'NETWORK', 'BLUETOOTH', 'BLE', 'SYSTEM']),
  address: z.string().nullable(),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  purpose: z.enum(['BILL', 'KOT', 'REPORT', 'LABEL']),
  /** KOT printers: the kitchen station it prints for; null = every station. */
  stationId: IdSchema.nullable().default(null),
  /** A printer attached to a tablet (Bluetooth), printed to by that device; null = the Hub prints. */
  deviceId: IdSchema.nullable().default(null),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type Printer = z.infer<typeof PrinterSchema>;
export const PrintersResponseSchema = z.object({ data: z.array(PrinterSchema) });
export type PrintersResponse = z.infer<typeof PrintersResponseSchema>;
export const SavePrinterRequestSchema = z.object({
  name: z.string().trim().min(2).max(60),
  connection: z.enum(['USB', 'NETWORK', 'BLUETOOTH', 'BLE', 'SYSTEM']),
  address: z.string().trim().max(200).nullable().default(null),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]).default(80),
  purpose: z.enum(['BILL', 'KOT', 'REPORT', 'LABEL']),
  stationId: IdSchema.nullable().default(null),
  deviceId: IdSchema.nullable().default(null),
});
export const UpdatePrinterRequestSchema = SavePrinterRequestSchema.partial().extend({
  version: z.number().int(),
  isActive: z.boolean().optional(),
});
