import { z } from 'zod';
import { IdSchema } from './common';

export const PrintRequestSchema = z.object({
  /** Default: the first active printer for the purpose (BILL for bills, REPORT then BILL for reports). */
  printerId: IdSchema.optional(),
});

export const PrintOutcomeSchema = z.object({
  printerId: IdSchema,
  printerName: z.string(),
  /** TEXT: the printer's built-in font. RASTER: drawn as an image (Hindi/Bengali receipts). */
  mode: z.enum(['TEXT', 'RASTER']),
  bytes: z.number().int(),
});
export type PrintOutcome = z.infer<typeof PrintOutcomeSchema>;
export const KotPrintResponseSchema = z.object({ data: z.array(PrintOutcomeSchema) });

/** A slip as blocks, for an on-screen preview or browser printing (GET /invoices/{id}/receipt). */
export const PrintBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    align: z.enum(['left', 'center', 'right']).optional(),
    bold: z.boolean().optional(),
    size: z.union([z.literal(1), z.literal(2)]).optional(),
  }),
  z.object({
    kind: z.literal('row'),
    left: z.string(),
    right: z.string(),
    bold: z.boolean().optional(),
    size: z.union([z.literal(1), z.literal(2)]).optional(),
  }),
  z.object({ kind: z.literal('rule'), char: z.enum(['-', '=']).optional() }),
  z.object({ kind: z.literal('qr'), data: z.string() }),
  z.object({ kind: z.literal('feed'), lines: z.number().int() }),
]);
export const PrintDocumentSchema = z.object({
  blocks: z.array(PrintBlockSchema),
  cut: z.boolean(),
});
export type PrintDocument = z.infer<typeof PrintDocumentSchema>;
