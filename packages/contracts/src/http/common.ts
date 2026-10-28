import { z } from 'zod';

export const IdSchema = z.uuid();
/** Integer paise. */
export const PaiseSchema = z.number().int();
/** Integer basis points: 5% = 500. */
export const BasisPointsSchema = z.number().int().min(0).max(100_00);
export const LocaleSchema = z.enum(['en-IN', 'hi-IN', 'bn-IN']);
export type Locale = z.infer<typeof LocaleSchema>;
/** Short language codes used for bilingual receipts. */
export const ReceiptLanguageSchema = z.enum(['en', 'hi', 'bn']);

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() });
}
