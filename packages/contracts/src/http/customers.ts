import { z } from 'zod';
import { IdSchema, LocaleSchema, PaiseSchema, patchSchema } from './common';

/** Indian mobile number, stored as E.164 (+91XXXXXXXXXX). 10 digits, or with +91 / 0 in front. */
export const IndianMobileSchema = z
  .string()
  .trim()
  .transform((v) => v.replaceAll(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(\+91|91|0)?[6-9]\d{9}$/, 'a 10-digit Indian mobile number'))
  .transform((v) => `+91${v.slice(-10)}`);

export const CustomerSchema = z.object({
  id: IdSchema,
  phone: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  /** B2B: GSTIN printed on their tax invoices. */
  taxId: z.string().nullable(),
  preferredLocale: LocaleSchema.nullable(),
  visitCount: z.number().int(),
  /** Paid bills minus refunds, in paise. */
  lifetimeValue: PaiseSchema,
  lastVisitAt: z.string().nullable(),
  marketingOptIn: z.boolean(),
  /** Loyalty points to spend (Phase 5). */
  loyaltyPoints: z.number().int(),
  version: z.number().int(),
});
export type Customer = z.infer<typeof CustomerSchema>;
export const CustomersResponseSchema = z.object({ data: z.array(CustomerSchema) });
export type CustomersResponse = z.infer<typeof CustomersResponseSchema>;

export const CustomerDetailSchema = CustomerSchema.extend({
  recentInvoices: z.array(
    z.object({
      id: IdSchema,
      invoiceNo: z.string(),
      businessDate: z.string(),
      grandTotal: PaiseSchema,
      status: z.string(),
    }),
  ),
  /** Most ordered dishes, by quantity. */
  favourites: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
});
export type CustomerDetail = z.infer<typeof CustomerDetailSchema>;

export const SaveCustomerRequestSchema = z.object({
  phone: IndianMobileSchema,
  name: z.string().trim().min(1).max(120).nullable().default(null),
  email: z.email().nullable().default(null),
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z0-9]{13}$/)
    .nullable()
    .default(null),
  preferredLocale: LocaleSchema.nullable().default(null),
  marketingOptIn: z.boolean().default(false),
});
export const UpdateCustomerRequestSchema = patchSchema(SaveCustomerRequestSchema).extend({
  version: z.number().int(),
});

export const LoyaltyEntrySchema = z.object({
  id: IdSchema,
  /** EARN on a paid bill, REDEEM when spent, ADJUST by a manager (EXPIRE is not used yet). */
  kind: z.enum(['EARN', 'REDEEM', 'EXPIRE', 'ADJUST']),
  /** Signed: + added, − taken away. */
  points: z.number().int(),
  invoiceId: IdSchema.nullable(),
  invoiceNo: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type LoyaltyEntry = z.infer<typeof LoyaltyEntrySchema>;
/** The balance, the latest 100 entries (newest first), and this branch's program. */
export const LoyaltyLedgerSchema = z.object({
  balance: z.number().int(),
  entries: z.array(LoyaltyEntrySchema),
  program: z.object({
    enabled: z.boolean(),
    earnPer100: z.number().int(),
    /** Paise per point. */
    pointValue: PaiseSchema,
    minRedeem: z.number().int(),
  }),
});
export type LoyaltyLedger = z.infer<typeof LoyaltyLedgerSchema>;

/** A manager adds or takes away points, with why (loyalty.adjust). */
export const AdjustLoyaltyRequestSchema = z.object({
  points: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((n) => n !== 0, 'not zero'),
  note: z.string().trim().min(3).max(200),
});
export type AdjustLoyaltyRequest = z.infer<typeof AdjustLoyaltyRequestSchema>;
