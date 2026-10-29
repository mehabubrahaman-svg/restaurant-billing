import { z } from 'zod';
import { FoodTypeSchema, TranslationsSchema } from './catalog';
import { IdSchema, PaiseSchema } from './common';

// ---- QR self-ordering (Phase 5) ----------------------------------------------------

/** What a guest sees after scanning the table's QR code (public, no sign-in). */
export const QrMenuSchema = z.object({
  branchName: z.string(),
  tableLabel: z.string(),
  categories: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      nameTranslations: TranslationsSchema,
      sortOrder: z.number().int(),
    }),
  ),
  items: z.array(
    z.object({
      id: IdSchema,
      categoryId: IdSchema,
      name: z.string(),
      nameTranslations: TranslationsSchema,
      description: z.string().nullable(),
      descriptionTranslations: TranslationsSchema,
      foodType: FoodTypeSchema,
      price: PaiseSchema,
      /** The price includes tax; otherwise tax is added on the bill. */
      taxIncluded: z.boolean(),
      variants: z.array(
        z.object({
          id: IdSchema,
          name: z.string(),
          nameTranslations: TranslationsSchema,
          price: PaiseSchema,
        }),
      ),
      addonGroupIds: z.array(IdSchema),
      isAvailable: z.boolean(),
    }),
  ),
  addonGroups: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      nameTranslations: TranslationsSchema,
      minSelect: z.number().int(),
      maxSelect: z.number().int(),
      addons: z.array(
        z.object({
          id: IdSchema,
          name: z.string(),
          nameTranslations: TranslationsSchema,
          price: PaiseSchema,
        }),
      ),
    }),
  ),
});
export type QrMenu = z.infer<typeof QrMenuSchema>;

export const QrRequestKindSchema = z.enum(['ORDER', 'WAITER', 'BILL']);
export const QrRequestStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'DONE']);

/** From the guest's phone: an order, or a call for the waiter or the bill. */
export const SubmitQrRequestSchema = z
  .object({
    kind: QrRequestKindSchema,
    items: z
      .array(
        z.object({
          menuItemId: IdSchema,
          variantId: IdSchema.optional(),
          quantity: z.number().int().min(1).max(20),
          addons: z
            .array(z.object({ addonId: IdSchema, quantity: z.number().int().min(1).max(10) }))
            .max(20)
            .default([]),
          note: z.string().trim().max(120).optional(),
        }),
      )
      .max(30)
      .default([]),
    guestName: z.string().trim().max(60).optional(),
    covers: z.number().int().min(1).max(50).optional(),
    note: z.string().trim().max(200).optional(),
    /** Made by the phone once per send, so a retry isn't a second order. */
    clientKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
  })
  .refine((r) => r.kind !== 'ORDER' || r.items.length > 0, 'add something to the order first');
export type SubmitQrRequest = z.input<typeof SubmitQrRequestSchema>;

const QrRequestItemSchema = z.object({
  menuItemId: IdSchema,
  variantId: IdSchema.nullable(),
  quantity: z.number().int(),
  addons: z.array(z.object({ addonId: IdSchema, quantity: z.number().int() })),
  note: z.string().nullable(),
  name: z.string(),
  variantName: z.string().nullable(),
  addonNames: z.array(z.string()),
});

/** The guest's view of their request. */
export const QrRequestStatusResponseSchema = z.object({
  id: IdSchema,
  kind: QrRequestKindSchema,
  status: QrRequestStatusSchema,
  items: z.array(QrRequestItemSchema),
  rejectReason: z.string().nullable(),
  createdAt: z.string(),
});
export type QrRequestStatusResponse = z.infer<typeof QrRequestStatusResponseSchema>;

/** A request as captains see it. */
export const QrRequestSchema = QrRequestStatusResponseSchema.extend({
  tableId: IdSchema,
  tableLabel: z.string(),
  guestName: z.string().nullable(),
  covers: z.number().int().nullable(),
  note: z.string().nullable(),
  version: z.number().int(),
});
export type QrRequest = z.infer<typeof QrRequestSchema>;
export const QrRequestsResponseSchema = z.object({ data: z.array(QrRequestSchema) });

export const AcceptQrRequestSchema = z.object({
  /** Send the items to the kitchen at once (the default). */
  fire: z.boolean().default(true),
});
export const RejectQrRequestSchema = z.object({ reason: z.string().trim().min(3).max(120) });
