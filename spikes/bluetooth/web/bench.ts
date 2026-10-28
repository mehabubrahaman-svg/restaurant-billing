import {
  SPIKE_PATHS,
  filler,
  sampleKotBody,
  type HubStats,
  type LinkStats,
} from '../src/bench-protocol';
import { kbPerSecond, summarize, type Summary } from '../src/stats';
import type { HubLink } from './hub-link';

/** The measurements. Each returns a JSON-serialisable result for the report. */

export interface EchoResult {
  readonly payload: 'small' | 'kot';
  readonly requestBytes: number;
  readonly framesOut: number;
  readonly framesIn: number;
  readonly failures: number;
  readonly rttMs: Summary | null;
}

export async function runEcho(
  link: HubLink,
  payload: 'small' | 'kot',
  count: number,
  progress: (i: number) => void,
): Promise<EchoResult> {
  const rtts: number[] = [];
  let failures = 0;
  let framesOut = 0;
  let framesIn = 0;
  let requestBytes = 0;
  for (let i = 0; i < count; i++) {
    const body = payload === 'kot' ? sampleKotBody() : { ping: i };
    try {
      const r = await link.client.request(
        { method: 'POST', path: SPIKE_PATHS.echo, body },
        { timeoutMs: 10_000 },
      );
      rtts.push(r.receivedAt - r.startedAt);
      framesOut = r.framesOut;
      framesIn = r.framesIn;
      requestBytes = r.wireBytesOut;
    } catch {
      failures++;
    }
    progress(i + 1);
  }
  return {
    payload,
    requestBytes,
    framesOut,
    framesIn,
    failures,
    rttMs: rtts.length > 0 ? summarize(rtts) : null,
  };
}

export interface ThroughputResult {
  readonly direction: 'upload' | 'download';
  readonly bytes: number;
  readonly writeMode: string;
  readonly mtu: number;
  readonly frames: number;
  readonly ms: number;
  readonly kbPerSec: number;
  readonly error?: string;
}

/** Upload: `sink` with `bytes` of filler, uncompressed. Time = first write → response. */
export async function runUpload(link: HubLink, bytes: number): Promise<ThroughputResult> {
  const base = {
    direction: 'upload',
    bytes,
    writeMode: link.writeMode,
    mtu: link.client.currentMtu,
  } as const;
  try {
    const r = await link.client.request(
      { method: 'POST', path: SPIKE_PATHS.sink, body: { data: filler(bytes) } },
      { compress: false, timeoutMs: 120_000 },
    );
    if (r.response.status !== 200) throw new Error(`HTTP ${r.response.status}`);
    const ms = r.receivedAt - r.startedAt;
    return { ...base, frames: r.framesOut, ms: Math.round(ms), kbPerSec: kbPerSecond(bytes, ms) };
  } catch (error) {
    return { ...base, frames: 0, ms: 0, kbPerSec: 0, error: String(error) };
  }
}

/** Download: `source` returns `bytes` of filler as notifications. Time = request written → response complete. */
export async function runDownload(link: HubLink, bytes: number): Promise<ThroughputResult> {
  const base = {
    direction: 'download',
    bytes,
    writeMode: link.writeMode,
    mtu: link.client.currentMtu,
  } as const;
  try {
    const r = await link.client.request(
      { method: 'POST', path: SPIKE_PATHS.source, body: { bytes, compress: false } },
      { compress: false, timeoutMs: 120_000 },
    );
    if (r.response.status !== 200) throw new Error(`HTTP ${r.response.status}`);
    const ms = r.receivedAt - r.writtenAt;
    return { ...base, frames: r.framesIn, ms: Math.round(ms), kbPerSec: kbPerSecond(bytes, ms) };
  } catch (error) {
    return { ...base, frames: 0, ms: 0, kbPerSec: 0, error: String(error) };
  }
}

export interface ReconnectSample {
  readonly kind: 'tablet-initiated' | 'hub-initiated';
  /** Disconnect → gatt.connect() resolved. */
  readonly gattConnectMs: number;
  /** Disconnect → first echo answered on the new link (discovery, notifications, hub-info included). */
  readonly usableMs: number;
  readonly attempts: number;
  readonly error?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Reconnects until the link answers an echo, retrying `gatt.connect()` while
 * the Hub is still re-advertising. `since` is when the link went down.
 */
async function reconnect(link: HubLink, since: number, deadlineMs: number) {
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      await link.connect();
      const gattConnectMs = performance.now() - since;
      await link.client.request(
        { method: 'POST', path: SPIKE_PATHS.echo, body: {} },
        { timeoutMs: 5_000 },
      );
      return { gattConnectMs, usableMs: performance.now() - since, attempts };
    } catch (error) {
      if (performance.now() - since > deadlineMs) throw error;
      await sleep(250);
    }
  }
}

export async function runReconnect(
  link: HubLink,
  kind: ReconnectSample['kind'],
  waitForDisconnect: () => Promise<number>,
): Promise<ReconnectSample> {
  try {
    let since: number;
    if (kind === 'tablet-initiated') {
      link.disconnect();
      since = performance.now();
    } else {
      const disconnected = waitForDisconnect();
      await link.client.request({ method: 'POST', path: SPIKE_PATHS.disconnect, body: {} });
      since = await disconnected;
    }
    const r = await reconnect(link, since, 30_000);
    return {
      kind,
      gattConnectMs: Math.round(r.gattConnectMs),
      usableMs: Math.round(r.usableMs),
      attempts: r.attempts,
    };
  } catch (error) {
    return { kind, gattConnectMs: 0, usableMs: 0, attempts: 0, error: String(error) };
  }
}

export async function fetchHubStats(
  link: HubLink,
): Promise<{ link: LinkStats; hub?: HubStats } | undefined> {
  try {
    const r = await link.client.request({ method: 'POST', path: SPIKE_PATHS.stats, body: {} });
    return r.response.body as { link: LinkStats; hub?: HubStats };
  } catch {
    return undefined;
  }
}
