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
