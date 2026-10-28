import { z } from 'zod';
import { FoodTypeSchema } from './catalog';
import { IdSchema } from './common';
import { KotStatusSchema, OpenOrderTypeSchema, OrderItemStatusSchema } from './ordering';

export const KotItemSchema = z.object({
  id: IdSchema,
  /** To show the dish in the cook's language from the cached menu; `name` is the English copy. */
  menuItemId: IdSchema,
  variantId: IdSchema.nullable(),
  name: z.string(),
  variantName: z.string().nullable(),
  foodType: FoodTypeSchema,
  quantity: z.number().int(),
  addons: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
  /** Shown in capitals with a flag on the KDS. */
  specialNote: z.string().nullable(),
  course: z.number().int(),
  status: OrderItemStatusSchema,
  cancelReason: z.string().nullable(),
});
export type KotItem = z.infer<typeof KotItemSchema>;

export const KotSchema = z.object({
  id: IdSchema,
  /** Per branch per business day. */
  kotNo: z.number().int(),
  businessDate: z.string(),
  orderId: IdSchema,
  orderNo: z.string(),
  orderType: OpenOrderTypeSchema.or(z.enum(['QR_SELF', 'KIOSK'])),
  tableLabel: z.string().nullable(),
  tokenNo: z.number().int().nullable(),
  captainId: IdSchema.nullable(),
  captainName: z.string().nullable(),
  kitchenStationId: IdSchema.nullable(),
  stationName: z.string().nullable(),
  status: KotStatusSchema,
  priority: z.number().int(),
  assignedChefId: IdSchema.nullable(),
  assignedChefName: z.string().nullable(),
  firedAt: z.string(),
  acceptedAt: z.string().nullable(),
  cookingAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  servedAt: z.string().nullable(),
  /** firedAt + the longest prep time among its items (default 15 min). Past it, the card turns red. */
  targetReadyAt: z.string(),
  items: z.array(KotItemSchema),
  version: z.number().int(),
});
export type Kot = z.infer<typeof KotSchema>;
export const KotsResponseSchema = z.object({ data: z.array(KotSchema) });
export type KotsResponse = z.infer<typeof KotsResponseSchema>;

/** NEW → ACCEPTED → COOKING → READY → SERVED. Steps may be skipped forward (NEW → READY), never back. */
export const SetKotStatusRequestSchema = z.object({
  to: z.enum(['ACCEPTED', 'COOKING', 'READY', 'SERVED']),
  version: z.number().int(),
});
export const AssignChefRequestSchema = z.object({
  chefId: IdSchema.nullable(),
  version: z.number().int(),
});
export const ChefsResponseSchema = z.object({
  data: z.array(z.object({ id: IdSchema, fullName: z.string() })),
});
export type ChefsResponse = z.infer<typeof ChefsResponseSchema>;

export const KitchenMetricsSchema = z.object({
  businessDate: z.string(),
  /** KOTs not yet ready. */
  pending: z.number().int(),
  /** Of those, past their target time. */
  delayed: z.number().int(),
  /** Fired → ready, over KOTs that reached READY today. Null before the first one. */
  avgCookSeconds: z.number().int().nullable(),
  completed: z.number().int(),
  perChef: z.array(
    z.object({
      chefId: IdSchema,
      fullName: z.string(),
      completed: z.number().int(),
      avgCookSeconds: z.number().int().nullable(),
    }),
  ),
});
export type KitchenMetrics = z.infer<typeof KitchenMetricsSchema>;

/** For the token display TV: takeaway/delivery tokens of the current business day. */
export const TokenBoardSchema = z.object({
  businessDate: z.string(),
  preparing: z.array(z.number().int()),
  ready: z.array(z.number().int()),
});
export type TokenBoard = z.infer<typeof TokenBoardSchema>;
