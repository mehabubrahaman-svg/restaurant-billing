import { z } from 'zod';
import { IdSchema } from './common';

// ---- online orders through the cloud relay (Phase 5) --------------------------------

/** The branch's link to the relay. The key is never sent back: `keySet` says one is saved. */
export const RelayLinkSchema = z.object({
  relayUrl: z.string(),
  hubId: z.string(),
  keySet: z.boolean(),
  isEnabled: z.boolean(),
  version: z.number().int(),
});
export type RelayLink = z.infer<typeof RelayLinkSchema>;

export const RelayStatusSchema = z.object({
  state: z.enum(['OFF', 'CONNECTING', 'CONNECTED', 'DISCONNECTED']),
  since: z.string(),
  lastConnectedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type RelayStatus = z.infer<typeof RelayStatusSchema>;

export const RelayMessageSchema = z.object({
  id: z.string(),
  direction: z.enum(['IN', 'OUT']),
  kind: z.string(),
  status: z.enum(['PENDING', 'SENT', 'DONE', 'FAILED', 'SKIPPED']),
  channelCode: z.string().nullable(),
  externalOrderId: z.string().nullable(),
  orderId: IdSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  handledAt: z.string().nullable(),
});
export type RelayMessage = z.infer<typeof RelayMessageSchema>;

export const RelayOverviewSchema = z.object({
  link: RelayLinkSchema.nullable(),
  status: RelayStatusSchema,
  /** Messages waiting for the relay, and online orders the Hub could not enter. */
  counts: z.object({ pendingOut: z.number().int(), failedIn: z.number().int() }),
  /** The latest 50 messages, newest first. */
  recent: z.array(RelayMessageSchema),
});
export type RelayOverview = z.infer<typeof RelayOverviewSchema>;

export const SaveRelayLinkRequestSchema = z.object({
  relayUrl: z.string().trim().min(8).max(200),
  hubId: z.string().trim().min(4).max(64),
  /** Required the first time; leave out to keep the saved key. */
  hubKey: z.string().trim().min(16).max(200).optional(),
  isEnabled: z.boolean(),
  version: z.number().int().optional(),
});
export type SaveRelayLinkRequest = z.infer<typeof SaveRelayLinkRequestSchema>;

export const RelayRetryResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
