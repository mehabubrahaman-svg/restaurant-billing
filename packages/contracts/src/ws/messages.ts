import { z } from 'zod';
import { IdSchema } from '../http/common';
import { TableStatusSchema } from '../http/floor';
import { KotSchema } from '../http/kitchen';
import { KotStatusSchema, OrderSummarySchema } from '../http/ordering';

/** WebSocket path, relative to the Hub origin (not under the REST prefix). */
export const WS_PATH = '/ws';
/** Close code when the first message isn't a valid `auth`. */
export const WS_CLOSE_UNAUTHENTICATED = 4401;

/**
 * Live updates (docs/05 §5). Every message carries the latest state of one
 * entity, never a diff, so a client can apply them in any order: keep the one
 * with the highest `version`. `seq` is the domain-event sequence the message
 * came from; send it back in `resume` after reconnecting.
 */
const envelope = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({
    type: z.literal(type),
    seq: z.number().int(),
    branchId: IdSchema,
    occurredAt: z.string(),
    data,
  });

export const ServerMessageSchema = z.discriminatedUnion('type', [
  envelope(
    'floor.table.status_changed',
    z.object({
      tableId: IdSchema,
      status: TableStatusSchema,
      orderId: IdSchema.nullable(),
      version: z.number().int(),
    }),
  ),
  envelope('ordering.order.updated', z.object({ order: OrderSummarySchema })),
  /** A new KOT. KDS screens chime. */
  envelope('kitchen.kot.fired', z.object({ kot: KotSchema })),
  /** Status moved (ACCEPTED, COOKING, READY, SERVED, CANCELLED). Captains get a "ready" alert. */
  envelope(
    'kitchen.kot.status_changed',
    z.object({ from: KotStatusSchema.nullable(), to: KotStatusSchema, kot: KotSchema }),
  ),
  /** Anything else on a KOT: an item bumped or cancelled, a chef assigned. */
  envelope('kitchen.kot.updated', z.object({ kot: KotSchema })),
  /** Past its target time; sent once per KOT. Not replayed on resume (`seq` is the latest at the time). */
  envelope('kitchen.kot.delayed', z.object({ kotId: IdSchema, overdueSeconds: z.number().int() })),
  /** A takeaway token is ready: the token display shows and chimes it. */
  envelope('token.ready', z.object({ tokenNo: z.number().int(), orderId: IdSchema })),
  /** Menu or availability changed: refetch GET /menu (it answers 304 if nothing did). */
  envelope('menu.changed', z.object({})),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ServerMessageType = ServerMessage['type'];

/** Control messages from the server. */
export const ServerControlSchema = z.discriminatedUnion('type', [
  /** First message after connecting. `seq` is the latest event; use it as lastSeq if you just loaded everything. */
  z.object({ type: z.literal('hello'), seq: z.number().int(), topics: z.array(z.string()) }),
  /** The gap since lastSeq is too large (or the access token changed branch): refetch everything. */
  z.object({ type: z.literal('resync'), seq: z.number().int(), reason: z.string() }),
  z.object({ type: z.literal('pong') }),
  /** The access token expired or the session was revoked: send a fresh `auth`. Until then only `tokens` messages arrive. */
  z.object({ type: z.literal('unauthenticated') }),
]);
export type ServerControl = z.infer<typeof ServerControlSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  /**
   * Must be the first message (the server closes the socket after 5 s
   * without it), and is sent again after every token refresh. `token` is the
   * access token, never put in the URL, where it would be logged. A paired
   * TOKEN_DISPLAY device with nobody signed in sends `token: null` and gets
   * the `tokens` topic from its device cookie.
   */
  z.object({ type: z.literal('auth'), token: z.string().nullable() }),
  /** Replays what you missed since `lastSeq` (latest state per entity), or answers `resync`. */
  z.object({ type: z.literal('resume'), lastSeq: z.number().int().nonnegative() }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/**
 * Which messages a connection receives depends on its permissions:
 * - `floor` (tables.view): table, order and KOT status messages, menu.changed
 * - `kitchen` (kds.view): every KOT message, delays, menu.changed
 * - `tokens` (anyone, including a paired TOKEN_DISPLAY device without a user): token.ready
 */
export const WS_TOPICS = ['floor', 'kitchen', 'tokens'] as const;
export type WsTopic = (typeof WS_TOPICS)[number];
