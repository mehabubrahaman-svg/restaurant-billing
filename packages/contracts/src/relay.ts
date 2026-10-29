import { z } from 'zod';
import { IdSchema } from './http/common';

/**
 * The cloud relay (docs/08 Phase 5, ADR 0007). An aggregator middleware posts
 * orders to the relay; the Hub keeps an outbound WebSocket to the relay, so
 * the restaurant opens no ports. Menu, availability and order status go back
 * the same way. Orders refer to the Hub's own ids, because the menu the
 * middleware shows was pushed from the Hub.
 */

/** The Hub connects to `<relay>/hub?hub=<hubId>` with `Authorization: Bearer <hub key>`. */
export const RELAY_HUB_PATH = '/hub';
/** The middleware signs each webhook body: `sha256=<hex HMAC-SHA256 with the hub's webhook secret>`. */
export const RELAY_SIGNATURE_HEADER = 'x-relay-signature';

const ChannelCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_]{2,20}$/);
const ExternalOrderId = z.string().trim().min(1).max(64);

export const RelayOrderSchema = z.object({
  /** The Hub's sales channel code, e.g. SWIGGY. */
  channel: ChannelCode,
  externalOrderId: ExternalOrderId,
  /** The rider's pickup code. */
  otp: z.string().trim().max(12).optional(),
  note: z.string().trim().max(200).optional(),
  items: z
    .array(
      z.object({
        menuItemId: IdSchema,
        variantId: IdSchema.optional(),
        quantity: z.number().int().min(1).max(99),
        addons: z
          .array(z.object({ addonId: IdSchema, quantity: z.number().int().min(1).max(10) }))
          .max(20)
          .default([]),
        note: z.string().trim().max(120).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type RelayOrder = z.infer<typeof RelayOrderSchema>;

/** What the middleware posts to `POST /webhooks/<hubId>`. */
export const RelayWebhookSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('order.created'), order: RelayOrderSchema }),
  z.object({
    event: z.literal('order.cancelled'),
    order: z.object({
      channel: ChannelCode,
      externalOrderId: ExternalOrderId,
      reason: z.string().trim().max(200).optional(),
    }),
  }),
]);
export type RelayWebhook = z.infer<typeof RelayWebhookSchema>;

/** The Hub's menu, as the middleware lists it on each aggregator. Liquor is left out. */
export const RelayMenuSchema = z.object({
  channels: z.array(z.object({ code: z.string(), priceMarkupBp: z.number().int() })),
  categories: z.array(z.object({ id: IdSchema, name: z.string(), sortOrder: z.number().int() })),
  items: z.array(
    z.object({
      id: IdSchema,
      categoryId: IdSchema,
      name: z.string(),
      description: z.string().nullable(),
      foodType: z.string(),
      /** Paise, before any channel markup. */
      price: z.number().int(),
      variants: z.array(z.object({ id: IdSchema, name: z.string(), price: z.number().int() })),
      addonGroups: z.array(
        z.object({
          id: IdSchema,
          name: z.string(),
          minSelect: z.number().int(),
          maxSelect: z.number().int(),
          addons: z.array(z.object({ id: IdSchema, name: z.string(), price: z.number().int() })),
        }),
      ),
      available: z.boolean(),
    }),
  ),
});
export type RelayMenu = z.infer<typeof RelayMenuSchema>;
export const RelayAvailabilitySchema = z.object({
  items: z.array(z.object({ menuItemId: IdSchema, available: z.boolean() })),
});
export const RelayOrderStatusSchema = z.object({
  channel: z.string(),
  externalOrderId: z.string(),
  status: z.enum(['ACCEPTED', 'READY', 'CANCELLED', 'REJECTED']),
  reason: z.string().optional(),
});
export type RelayOrderStatus = z.infer<typeof RelayOrderStatusSchema>;

export const RelayOutboundKindSchema = z.enum(['menu', 'availability', 'order-status']);
export type RelayOutboundKind = z.infer<typeof RelayOutboundKindSchema>;

/** Relay → Hub. */
export const RelayToHubSchema = z.discriminatedUnion('type', [
  /** A webhook for the Hub; the Hub answers with `ack`. Redelivered until acknowledged. */
  z.object({ type: z.literal('deliver'), id: z.string(), message: RelayWebhookSchema }),
  /** The relay has stored the Hub's `send` and will forward it. */
  z.object({ type: z.literal('stored'), id: z.string() }),
]);
export type RelayToHub = z.infer<typeof RelayToHubSchema>;

/** Hub → relay. */
export const HubToRelaySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ack'),
    id: z.string(),
    ok: z.boolean(),
    error: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('send'),
    id: z.string().min(8).max(64),
    kind: RelayOutboundKindSchema,
    payload: z.unknown(),
  }),
]);
export type HubToRelay = z.infer<typeof HubToRelaySchema>;
