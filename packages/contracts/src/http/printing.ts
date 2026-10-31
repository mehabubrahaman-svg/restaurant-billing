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
  /** Sent to the tablet the Bluetooth printer is attached to, which prints it (apps/android). */
  queuedOnDevice: z.boolean().optional(),
});
export type PrintOutcome = z.infer<typeof PrintOutcomeSchema>;
/**
 * A job for a Bluetooth printer attached to this tablet (GET /devices/me/print-jobs).
 * `data` is the ESC/POS bytes, base64; the tablet's app sends them as they are.
 */
export const DevicePrintJobSchema = z.object({
  id: IdSchema,
  printerId: IdSchema,
  printerName: z.string(),
  /** BLUETOOTH: classic (SPP) printer paired in Android settings. BLE: Bluetooth Low Energy. */
  connection: z.enum(['BLUETOOTH', 'BLE']),
  /** The printer's Bluetooth MAC address, e.g. 66:22:B3:01:4C:7A. */
  address: z.string(),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  data: z.string(),
  createdAt: z.string(),
});
export type DevicePrintJob = z.infer<typeof DevicePrintJobSchema>;
export const DevicePrintJobsResponseSchema = z.object({ data: z.array(DevicePrintJobSchema) });
export type DevicePrintJobsResponse = z.infer<typeof DevicePrintJobsResponseSchema>;
export const DevicePrintResultRequestSchema = z.object({
  ok: z.boolean(),
  error: z.string().trim().max(200).optional(),
});

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
