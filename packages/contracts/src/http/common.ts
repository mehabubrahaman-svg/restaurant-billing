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

type WithoutDefault<T> = T extends z.ZodDefault<infer Inner> ? Inner : T;

/**
 * The body of a PATCH: every field optional, and no defaults. `.partial()`
 * keeps a field's `.default()`, so a field left out of the request would be
 * reset to its default instead of kept.
 */
export function patchSchema<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      z.optional((field instanceof z.ZodDefault ? field.unwrap() : field) as z.ZodType),
    ]),
  ) as unknown as { [K in keyof Shape]: z.ZodOptional<WithoutDefault<Shape[K]>> };
  return z.object(shape);
}
