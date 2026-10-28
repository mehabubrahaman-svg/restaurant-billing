import { z } from 'zod';
import { IdSchema, patchSchema } from './common';
import { IndianMobileSchema } from './customers';

export const ReservationStatusSchema = z.enum(['BOOKED', 'SEATED', 'CANCELLED', 'NO_SHOW']);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

/** A table booked ahead. Only BOOKED reservations can change; the rest are history. */
export const ReservationSchema = z.object({
  id: IdSchema,
  /** `null`: no table chosen yet; the captain picks one when the guests arrive. */
  tableId: IdSchema.nullable(),
  tableLabel: z.string().nullable(),
  /** The guest's customer record (found or added by phone). */
  customerId: IdSchema.nullable(),
  guestName: z.string(),
  guestPhone: z.string().nullable(),
  partySize: z.number().int().positive(),
  /** ISO 8601 instant. */
  reservedFor: z.string(),
  status: ReservationStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type Reservation = z.infer<typeof ReservationSchema>;
export const ReservationsResponseSchema = z.object({ data: z.array(ReservationSchema) });
export type ReservationsResponse = z.infer<typeof ReservationsResponseSchema>;

/** The next booking on a table, shown on its floor tile. */
export const TableReservationSchema = z.object({
  id: IdSchema,
  guestName: z.string(),
  partySize: z.number().int(),
  reservedFor: z.string(),
});
export type TableReservation = z.infer<typeof TableReservationSchema>;

export const SaveReservationRequestSchema = z.object({
  guestName: z.string().trim().min(1).max(120),
  guestPhone: IndianMobileSchema.nullable().default(null),
  partySize: z.number().int().min(1).max(200),
  reservedFor: z.iso.datetime({ offset: true }),
  tableId: IdSchema.nullable().default(null),
  notes: z.string().trim().max(500).nullable().default(null),
});
export type SaveReservationRequest = z.input<typeof SaveReservationRequestSchema>;
export const UpdateReservationRequestSchema = patchSchema(SaveReservationRequestSchema).extend({
  version: z.number().int(),
});
export type UpdateReservationRequest = z.input<typeof UpdateReservationRequestSchema>;

/** Seat, cancel, no-show: the version the caller saw. */
export const ReservationActionRequestSchema = z.object({ version: z.number().int() });

/** Without dates: from 3 hours ago to 30 days ahead. At most 62 days at once. */
export const ReservationsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
