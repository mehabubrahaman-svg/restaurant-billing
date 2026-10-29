import { z } from 'zod';
import { FoodTypeSchema } from './catalog';
import { IdSchema, PaiseSchema, patchSchema } from './common';

const Version = z.number().int();

/** Order types taken in Phase 1. QR self-ordering and kiosks arrive later. */
export const OpenOrderTypeSchema = z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']);
export const OrderStatusSchema = z.enum([
  'PENDING_APPROVAL',
  'OPEN',
  'BILLED',
  'PAID',
  'CANCELLED',
  'VOID',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
/**
 * PENDING: on the order pad, not yet sent. SENT → PREPARING → READY → SERVED
 * follow the kitchen. CANCELLED items stay on the order (struck through).
 */
export const OrderItemStatusSchema = z.enum([
  'PENDING',
  'SENT',
  'PREPARING',
  'READY',
  'SERVED',
  'CANCELLED',
]);
export type OrderItemStatus = z.infer<typeof OrderItemStatusSchema>;
export const KotStatusSchema = z.enum([
  'NEW',
  'ACCEPTED',
  'COOKING',
  'READY',
  'SERVED',
  'CANCELLED',
]);
export type KotStatus = z.infer<typeof KotStatusSchema>;

export const OrderItemAddonSchema = z.object({
  addonId: IdSchema,
  name: z.string(),
  /** Per unit of the parent item. */
  price: PaiseSchema,
  quantity: z.number().int().positive(),
});

export const OrderItemSchema = z.object({
  id: IdSchema,
  menuItemId: IdSchema,
  variantId: IdSchema.nullable(),
  /** Names and prices are copied at order time; later menu changes don't alter them. */
  name: z.string(),
  variantName: z.string().nullable(),
  foodType: FoodTypeSchema,
  unitPrice: PaiseSchema,
  addons: z.array(OrderItemAddonSchema),
  /** Add-ons per unit. */
  addonsTotal: PaiseSchema,
  quantity: z.number().int().positive(),
  /** (unitPrice + addonsTotal) × quantity. */
  lineTotal: PaiseSchema,
  specialNote: z.string().nullable(),
  course: z.number().int().positive(),
  status: OrderItemStatusSchema,
  kotId: IdSchema.nullable(),
  kitchenStationId: IdSchema.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  version: Version,
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const KotSummarySchema = z.object({
  id: IdSchema,
  kotNo: z.number().int(),
  kitchenStationId: IdSchema.nullable(),
  stationName: z.string().nullable(),
  status: KotStatusSchema,
  firedAt: z.string(),
  readyAt: z.string().nullable(),
  /** For POST /kitchen/kots/{id}/status (a captain marking it SERVED). */
  version: z.number().int(),
});
export type KotSummary = z.infer<typeof KotSummarySchema>;

/** What lists, the floor and live updates carry: no item lines. */
export const OrderSummarySchema = z.object({
  id: IdSchema,
  /** Per branch per business day: 1, 2, 3 … shown as "#142". */
  orderNo: z.string(),
  /** Takeaway and delivery only: the number on the token display. */
  tokenNo: z.number().int().nullable(),
  businessDate: z.string(),
  orderType: OpenOrderTypeSchema.or(z.enum(['QR_SELF', 'KIOSK'])),
  status: OrderStatusSchema,
  tableId: IdSchema.nullable(),
  tableLabel: z.string().nullable(),
  /** Aggregator orders: the channel and its order id. */
  salesChannelId: IdSchema.nullable(),
  salesChannelName: z.string().nullable(),
  externalOrderId: z.string().nullable(),
  covers: z.number().int().nullable(),
  captainId: IdSchema.nullable(),
  captainName: z.string().nullable(),
  notes: z.string().nullable(),
  /** Sum of line totals of items that aren't cancelled; before tax, charges and discounts. */
  subtotal: PaiseSchema,
  /** Units (quantities) not cancelled. */
  itemCount: z.number().int(),
  /** Units still on the pad, not sent to the kitchen. */
  pendingCount: z.number().int(),
  /** Units the kitchen marked ready but not yet served. */
  readyCount: z.number().int(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  version: Version,
});
export type OrderSummary = z.infer<typeof OrderSummarySchema>;

export const OrderSchema = OrderSummarySchema.extend({
  items: z.array(OrderItemSchema),
  kots: z.array(KotSummarySchema),
});
export type Order = z.infer<typeof OrderSchema>;
export const OrdersResponseSchema = z.object({ data: z.array(OrderSummarySchema) });
export type OrdersResponse = z.infer<typeof OrdersResponseSchema>;

// ---- commands ----------------------------------------------------------------------
export const OpenOrderRequestSchema = z
  .object({
    orderType: OpenOrderTypeSchema,
    /** Required for DINE_IN; the table must be free or reserved. */
    tableId: IdSchema.optional(),
    covers: z.number().int().min(1).max(100).optional(),
    notes: z.string().trim().max(200).optional(),
  })
  .refine((o) => o.orderType !== 'DINE_IN' || o.tableId !== undefined, {
    message: 'a dine-in order needs a table',
    path: ['tableId'],
  });
export type OpenOrderRequest = z.input<typeof OpenOrderRequestSchema>;

export const UpdateOrderRequestSchema = z.object({
  version: Version,
  covers: z.number().int().min(1).max(100).nullable().optional(),
  notes: z.string().trim().max(200).nullable().optional(),
});

export const NewOrderItemSchema = z.object({
  menuItemId: IdSchema,
  /** Required when the item has variants (Half / Full). */
  variantId: IdSchema.optional(),
  quantity: z.number().int().min(1).max(99),
  addons: z
    .array(z.object({ addonId: IdSchema, quantity: z.number().int().min(1).max(10).default(1) }))
    .max(20)
    .default([]),
  specialNote: z.string().trim().max(140).optional(),
  course: z.number().int().min(1).max(5).default(1),
});
export type NewOrderItem = z.input<typeof NewOrderItemSchema>;
export const AddOrderItemsRequestSchema = z.object({
  items: z.array(NewOrderItemSchema).min(1).max(50),
});

/** Only while the item is PENDING (not yet sent to the kitchen). */
export const UpdateOrderItemRequestSchema = z.object({
  version: Version,
  quantity: z.number().int().min(1).max(99).optional(),
  specialNote: z.string().trim().max(140).nullable().optional(),
  course: z.number().int().min(1).max(5).optional(),
});

/**
 * A PENDING item is simply removed (needs orders.update). An item already sent
 * to the kitchen needs orders.item_cancel or a manager's approval, and a reason.
 */
export const CancelOrderItemRequestSchema = z.object({
  version: Version,
  reason: z.string().trim().min(3).max(200).optional(),
  /** Food was already made and is thrown away (counts as wastage in Phase 2). */
  isWastage: z.boolean().default(false),
});

/** Nothing sent yet: orders.update. Anything sent: orders.cancel or a manager's approval. */
export const CancelOrderRequestSchema = z.object({
  version: Version,
  reason: z.string().trim().min(3).max(200),
});

/** Sends every PENDING item: one KOT per kitchen station. */
export const FireKotsResponseSchema = z.object({
  order: OrderSchema,
  kots: z.array(KotSummarySchema),
});
export type FireKotsResponse = z.infer<typeof FireKotsResponseSchema>;

/**
 * MOVE: the order goes to an empty table. MERGE: its items join the open
 * order on the target table and this order is closed as merged.
 */
export const TransferTableRequestSchema = z.object({
  targetTableId: IdSchema,
  mode: z.enum(['MOVE', 'MERGE']),
});

// ---- sales channels and aggregator orders (Swiggy, Zomato, …) -------------------------------
export const SalesChannelSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  kind: z.enum(['DIRECT', 'AGGREGATOR', 'OWN_ONLINE']),
  integration: z.enum(['MANUAL', 'MIDDLEWARE', 'DIRECT_API']),
  /** The aggregator's commission, for net revenue per channel. */
  commissionBp: z.number().int(),
  /** Channel prices = menu prices + this much. */
  priceMarkupBp: z.number().int(),
  /** CGST Act s.9(5): the operator pays the GST, so the bill charges none. */
  gstPaidByOperator: z.boolean(),
  /** The operator's GSTIN, listed in GSTR-1 table 14. */
  operatorGstin: z.string().nullable().default(null),
  isActive: z.boolean(),
  version: Version,
});
export type SalesChannel = z.infer<typeof SalesChannelSchema>;
export const SalesChannelsResponseSchema = z.object({ data: z.array(SalesChannelSchema) });
export type SalesChannelsResponse = z.infer<typeof SalesChannelsResponseSchema>;
export const SaveSalesChannelRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/),
  name: z.string().trim().min(2).max(60),
  kind: z.enum(['AGGREGATOR', 'OWN_ONLINE']).default('AGGREGATOR'),
  commissionBp: z.number().int().min(0).max(10_000).default(0),
  priceMarkupBp: z.number().int().min(0).max(10_000).default(0),
  gstPaidByOperator: z.boolean().default(true),
  operatorGstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/, 'a 15-character GSTIN')
    .nullable()
    .default(null),
});
export const UpdateSalesChannelRequestSchema = patchSchema(SaveSalesChannelRequestSchema).extend({
  version: Version,
  isActive: z.boolean().optional(),
});

/** Keyed in from the aggregator's tablet: a DELIVERY with a token, sent to the kitchen unless `fire` is false. */
export const AggregatorOrderRequestSchema = z.object({
  salesChannelId: IdSchema,
  externalOrderId: z.string().trim().min(3).max(40),
  /** Rider pickup code, printed on the bill. */
  externalOtp: z.string().trim().max(12).optional(),
  notes: z.string().trim().max(200).optional(),
  items: z.array(NewOrderItemSchema).min(1).max(50),
  fire: z.boolean().default(true),
});
