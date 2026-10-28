import { z } from 'zod';
import { MAX_ATTRIBUTE_VALUE_BYTES, MAX_USEFUL_ATT_MTU, MIN_ATT_MTU } from './frame';
import { encodeJson } from './message';
import { BLE_PROTOCOL_VERSION } from './uuids';

/**
 * Payloads of the readable characteristics and the envelopes carried inside
 * frames. `hub-info` and `pairing` are single attribute values, so their JSON
 * must fit in 512 bytes; the field limits below guarantee that
 * (`encodeReadValue` checks it anyway).
 */

/** SHA-256 of the local CA certificate (DER), lowercase hex without separators. */
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'expected lowercase hex SHA-256');

export const bleHubInfoSchema = z.object({
  hubId: z.uuid(),
  /** Shown in the tablet's "Find Hub" list. At most 24 characters. */
  name: z.string().min(1).max(24),
  /** Current LAN base URLs, most preferred first, e.g. `https://192.168.1.20:7400`. */
  urls: z
    .array(z.url({ protocol: /^https$/ }).max(60))
    .min(1)
    .max(3),
  caFingerprint: sha256Hex,
  protocol: z.literal(BLE_PROTOCOL_VERSION),
  /**
   * ATT MTU negotiated with the central that is reading, when the Hub's stack
   * reports it. Web Bluetooth does not expose the MTU, so tablets size their
   * `cmd-in` frames from this (falling back to 23).
   */
  mtu: z.int().min(MIN_ATT_MTU).max(MAX_USEFUL_ATT_MTU).optional(),
});
export type BleHubInfo = z.infer<typeof bleHubInfoSchema>;

export const PAIRING_NONCE_ROTATION_MS = 60_000;

export const blePairingSchema = z.object({
  hubId: z.uuid(),
  /** ≥ 128 random bits, base64url. The same nonce the on-screen pairing QR carries. */
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
  /** Epoch ms after which the Hub no longer accepts this nonce. */
  expiresAt: z.int().nonnegative(),
});
export type BlePairing = z.infer<typeof blePairingSchema>;

/** Header names are lowercase (as in HTTP/2); values are strings. */
const headersSchema = z.record(
  z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
  z.string().max(8192),
);

export const BLE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type BleMethod = (typeof BLE_METHODS)[number];

/** Tablet → Hub on `cmd-in`. `path` is relative to `/api/v1` and may carry a query string. */
export const bleRequestSchema = z.object({
  /** Client-chosen correlation id (UUID recommended); echoed in the response. */
  id: z.string().min(1).max(64),
  method: z.enum(BLE_METHODS),
  path: z.string().startsWith('/').max(512),
  headers: headersSchema,
  body: z.unknown().optional(),
});
export type BleRequest = z.infer<typeof bleRequestSchema>;

/** Hub → tablet on `evt-out`, answering the request with the same `id`. */
export const bleResponseSchema = z.object({
  id: z.string().min(1).max(64),
  status: z.int().min(100).max(599),
  headers: headersSchema,
  body: z.unknown().optional(),
});
export type BleResponse = z.infer<typeof bleResponseSchema>;

/** Hub → tablet on `evt-out`: the same envelope as the WebSocket protocol (docs/05 §5). */
export const bleEventSchema = z.object({
  type: z.string().min(1).max(64),
  seq: z.int().nonnegative(),
  branchId: z.string().min(1),
  occurredAt: z.string().min(1),
  data: z.unknown(),
});
export type BleEvent = z.infer<typeof bleEventSchema>;

/** Anything a tablet can receive on `evt-out`. A response has `status`; an event has `type`. */
export const bleOutboundSchema = z.union([bleResponseSchema, bleEventSchema]);
export type BleOutbound = z.infer<typeof bleOutboundSchema>;

export function isBleResponse(message: BleOutbound): message is BleResponse {
  return 'status' in message;
}

/**
 * Serializes a `hub-info` or `pairing` value, refusing anything over the
 * 512-byte attribute limit (a longer value would be silently cut off by
 * some stacks).
 */
export function encodeReadValue(value: BleHubInfo | BlePairing): Uint8Array {
  const bytes = encodeJson(value);
  if (bytes.byteLength > MAX_ATTRIBUTE_VALUE_BYTES) {
    throw new RangeError(
      `characteristic value is ${bytes.byteLength} B; max is ${MAX_ATTRIBUTE_VALUE_BYTES}`,
    );
  }
  return bytes;
}
