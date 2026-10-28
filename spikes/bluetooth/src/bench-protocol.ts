/**
 * Bench commands of the spike Hub. They travel as ordinary `BleRequest`
 * envelopes on reserved `/_spike/*` paths, so every measurement goes through
 * exactly the framing, JSON and correlation a real KOT request would.
 * Shared by the Hub (Node) and the measurement page (browser): no Node APIs.
 */

export const SPIKE_PATHS = {
  /** Responds with the request body. Round-trip latency. */
  echo: '/_spike/echo',
  /** Accepts `{ data: string }`, responds with its size. Upload throughput. */
  sink: '/_spike/sink',
  /** Accepts `{ bytes, compress? }`, responds with `{ data }` of that many chars. Download throughput. */
  source: '/_spike/source',
  /** Hub and per-link counters. */
  stats: '/_spike/stats',
  /** Responds, then the Hub drops the link. Reconnect time after a Hub-side disconnect. */
  disconnect: '/_spike/disconnect',
} as const;

/** Largest `source` response the Hub will build (stays under the 256 KiB message limit). */
export const MAX_SOURCE_BYTES = 200_000;

export interface SinkResult {
  readonly receivedChars: number;
  /** Bytes on the wire (after compression, if any) and frame count of the request. */
  readonly wireBytes: number;
  readonly frames: number;
}

export interface SourceRequest {
  readonly bytes: number;
  /** Default false: throughput tests measure raw frames. */
  readonly compress?: boolean;
}

export interface LinkStats {
  readonly id: string;
  readonly address: string;
  readonly connectedAt: string;
  readonly mtu: number;
  readonly framesIn: number;
  readonly framesOut: number;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly messagesIn: number;
  readonly messagesOut: number;
  readonly frameErrors: Readonly<Record<string, number>>;
}

export interface HubStats {
  readonly startedAt: string;
  readonly backend: string;
  readonly connections: readonly LinkStats[];
  readonly totalConnections: number;
}

/**
 * Deterministic printable filler of `length` characters. JSON-safe (no
 * escaping, so chars = bytes) and not trivially compressible, so it is honest
 * even if compression is switched on by mistake.
 */
export function filler(length: number, seed = 1): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let x = seed >>> 0 || 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out += alphabet[x & 63];
  }
  return out;
}

/** A realistic KOT-sized request body (about 600 B of JSON) for latency tests. */
export function sampleKotBody(): unknown {
  return {
    idempotencyKey: '0190f3a2-0000-7abc-8def-0123456789ab',
    items: [
      { menuItemId: '0190f3a2-1111-7abc-8def-000000000001', quantity: 2, addons: [] },
      {
        menuItemId: '0190f3a2-1111-7abc-8def-000000000002',
        variantId: '0190f3a2-2222-7abc-8def-000000000002',
        quantity: 1,
        addons: [{ addonId: '0190f3a2-3333-7abc-8def-000000000001', quantity: 1 }],
        specialNote: 'less spicy, no onion',
      },
      { menuItemId: '0190f3a2-1111-7abc-8def-000000000003', quantity: 3, addons: [], course: 2 },
      { menuItemId: '0190f3a2-1111-7abc-8def-000000000004', quantity: 1, addons: [] },
    ],
  };
}
