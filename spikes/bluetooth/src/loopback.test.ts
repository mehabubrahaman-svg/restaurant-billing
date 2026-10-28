import {
  BLE_ROUTE_NOT_ALLOWED,
  FRAME_HEADER_BYTES,
  FrameAssembler,
  decodeJson,
  createMsgIdCounter,
  decodeFrame,
  encodeJson,
  frameCount,
  frameMessage,
  maxFrameBytes,
  streamGzip,
  type BleCompression,
} from '@restroos/contracts/ble';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SPIKE_PATHS,
  filler,
  sampleKotBody,
  type LinkStats,
  type SinkResult,
} from './bench-protocol';
import { HubSession } from './hub-session';
import { RpcClient } from './rpc-client';
import { zlibGzip } from './zlib-compression';

/**
 * End-to-end through the codec with no Bluetooth: RpcClient frames →
 * HubSession (as hub.ts wires it) → frames → RpcClient. A fake link enforces
 * the MTU on every frame in both directions and can drop or duplicate frames.
 */

interface LoopbackOptions {
  mtu: number;
  hubCompression?: BleCompression;
  clientCompression?: BleCompression;
  /** Return false to drop a notification. */
  notifyFilter?: (frame: Uint8Array, index: number) => boolean;
  onFrameError?: (code: string) => void;
  requestTimeoutMs?: number;
}

const sessions: HubSession[] = [];
afterEach(() => sessions.splice(0).forEach((s) => s.close()));

function loopback(options: LoopbackOptions) {
  const uplink: Uint8Array[] = [];
  const downlink: Uint8Array[] = [];
  let disconnected = false;
  let notified = 0;
  // eslint-disable-next-line prefer-const -- assigned after the session that references it
  let client: RpcClient;
  const session = new HubSession({
    id: 'link-1',
    address: 'aa:bb:cc:dd:ee:ff',
    mtu: () => options.mtu,
    nextMsgId: createMsgIdCounter(),
    ...(options.hubCompression ? { compression: options.hubCompression } : {}),
    disconnect: () => (disconnected = true),
    notify: async (frame) => {
      expect(frame.byteLength).toBeLessThanOrEqual(maxFrameBytes(options.mtu));
      downlink.push(frame);
      if (options.notifyFilter?.(frame, notified++) === false) return;
      client.onFrame(frame);
    },
  });
  sessions.push(session);
  client = new RpcClient({
    mtu: options.mtu,
    requestTimeoutMs: options.requestTimeoutMs ?? 2_000,
    onFrameError: (e) => options.onFrameError?.(e.code),
    ...(options.clientCompression ? { compression: options.clientCompression } : {}),
    writeFrame: async (frame) => {
      expect(frame.byteLength).toBeLessThanOrEqual(maxFrameBytes(options.mtu));
      uplink.push(frame);
      session.onFrame(frame);
    },
  });
  return { session, client, uplink, downlink, isDisconnected: () => disconnected };
}

describe.each([23, 185, 247, 517])('loopback at MTU %i', (mtu) => {
  it('echoes a KOT-sized body', async () => {
    const { client } = loopback({ mtu });
    const body = sampleKotBody();
    const r = await client.request({ method: 'POST', path: SPIKE_PATHS.echo, body });
    expect(r.response).toMatchObject({ status: 200, body });
    expect(r.framesOut).toBe(frameCount(r.wireBytesOut - FRAME_HEADER_BYTES * r.framesOut, mtu));
  });

  it.each([1_000, 10_000, 100_000])('sinks %i bytes', async (bytes) => {
    const { client, uplink } = loopback({ mtu });
    const r = await client.request(
      { method: 'POST', path: SPIKE_PATHS.sink, body: { data: filler(bytes) } },
      { compress: false },
    );
    const result = r.response.body as SinkResult;
    expect(result.receivedChars).toBe(bytes);
    expect(result.frames).toBe(uplink.length);
    expect(result.frames).toBe(r.framesOut);
  });

  it.each([0, 1_000, 10_000, 100_000])('sources %i bytes', async (bytes) => {
    const { client, downlink } = loopback({ mtu });
    const r = await client.request({ method: 'POST', path: SPIKE_PATHS.source, body: { bytes } });
    expect((r.response.body as { data: string }).data).toBe(filler(bytes));
    expect(r.framesIn).toBe(downlink.length);
  });
});

describe('loopback behaviour', () => {
  it('compresses across implementations: zlib on the Hub, CompressionStream on the tablet', async () => {
    const { client, uplink, downlink } = loopback({
      mtu: 185,
      hubCompression: zlibGzip,
      clientCompression: streamGzip(),
    });
    const text = 'Paneer Tikka x2, no onion; '.repeat(400);
    const r = await client.request({ method: 'POST', path: SPIKE_PATHS.echo, body: { text } });
    expect(r.response.body).toEqual({ text });
    const compressed = (f: Uint8Array) => decodeFrame(f).ok && (f[4]! & 0b10) !== 0;
    expect(uplink.every(compressed)).toBe(true);
    expect(downlink.every(compressed)).toBe(true);
    expect(r.wireBytesOut).toBeLessThan(text.length / 5);
  });

  it('honours compress:false on source even when the Hub can compress', async () => {
    const { client, downlink } = loopback({
      mtu: 247,
      hubCompression: zlibGzip,
      clientCompression: streamGzip(),
    });
    await client.request({
      method: 'POST',
      path: SPIKE_PATHS.source,
      body: { bytes: 5_000, compress: false },
    });
    expect(downlink.some((f) => (f[4]! & 0b10) !== 0)).toBe(false);
  });

  it('correlates concurrent requests whose frames interleave', async () => {
    const { client } = loopback({ mtu: 23 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.request({
          method: 'POST',
          path: SPIKE_PATHS.echo,
          body: { i, pad: filler(i * 37) },
        }),
      ),
    );
    results.forEach((r, i) => expect(r.response.body).toEqual({ i, pad: filler(i * 37) }));
  });

  it('refuses routes outside the BLE allow-list with 403', async () => {
    const { client } = loopback({ mtu: 185 });
    const r = await client.request({ method: 'GET', path: '/reports/day-end' });
    expect(r.response).toMatchObject({ status: 403, body: { code: BLE_ROUTE_NOT_ALLOWED } });
  });

  it('answers allowed routes with 501 (no application layer in the spike)', async () => {
    const { client } = loopback({ mtu: 185 });
    const r = await client.request({ method: 'POST', path: '/orders/abc/kots', body: {} });
    expect(r.response).toMatchObject({ status: 501, body: { code: 'NOT_IMPLEMENTED_IN_SPIKE' } });
  });

  it('rejects invalid bench input with 422 and unknown bench commands with 404', async () => {
    const { client } = loopback({ mtu: 185 });
    const big = await client.request({
      method: 'POST',
      path: SPIKE_PATHS.source,
      body: { bytes: 10_000_000 },
    });
    expect(big.response.status).toBe(422);
    const sink = await client.request({
      method: 'POST',
      path: SPIKE_PATHS.sink,
      body: { data: 5 },
    });
    expect(sink.response.status).toBe(422);
    const unknown = await client.request({ method: 'POST', path: '/_spike/nope' });
    expect(unknown.response.status).toBe(404);
  });

  it('answers a schema-invalid envelope that has an id with 422', async () => {
    const { session, downlink } = loopback({ mtu: 185 });
    const bad = encodeJson({ id: 'x1', method: 'TRACE', path: '/orders', headers: {} });
    frameMessage(bad, { mtu: 185, msgId: 900 }).forEach((f) => session.onFrame(f));
    await vi.waitFor(() => expect(downlink.length).toBeGreaterThan(0));
    const assembler = new FrameAssembler();
    const done = downlink.flatMap((f) => assembler.push(f)).find((e) => e.kind === 'message');
    if (done?.kind !== 'message') throw new Error('no response');
    expect(decodeJson(done.message.payload)).toMatchObject({ id: 'x1', status: 422 });
  });

  it('reports link counters through stats', async () => {
    const { client, uplink, downlink } = loopback({ mtu: 23 });
    await client.request({ method: 'POST', path: SPIKE_PATHS.echo, body: { a: 1 } });
    const r = await client.request({ method: 'POST', path: SPIKE_PATHS.stats });
    const { link } = r.response.body as { link: LinkStats };
    expect(link).toMatchObject({ id: 'link-1', mtu: 23, messagesIn: 2, messagesOut: 1 });
    expect(link.framesIn).toBe(uplink.length);
    expect(link.framesOut).toBeLessThan(downlink.length); // the stats response itself is not yet counted
  });

  it('drops the link after answering disconnect', async () => {
    const { client, isDisconnected } = loopback({ mtu: 185 });
    const r = await client.request({ method: 'POST', path: SPIKE_PATHS.disconnect });
    expect(r.response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(isDisconnected()).toBe(true);
  });

  it('surfaces a dropped notification as a GAP and times the request out', async () => {
    const errors: string[] = [];
    const { client } = loopback({
      mtu: 23,
      requestTimeoutMs: 300,
      notifyFilter: (_frame, index) => index !== 2,
      onFrameError: (code) => errors.push(code),
    });
    await expect(
      client.request({ method: 'POST', path: SPIKE_PATHS.source, body: { bytes: 200 } }),
    ).rejects.toThrow(/timed out/);
    expect(errors).toContain('GAP');
  });

  it('fails outstanding requests on reset (link lost)', async () => {
    const client = new RpcClient({ mtu: 23, writeFrame: async () => undefined });
    const pending = client.request({ method: 'POST', path: SPIKE_PATHS.echo });
    await new Promise((resolve) => setTimeout(resolve, 10));
    client.reset('link lost');
    await expect(pending).rejects.toThrow('link lost');
  });

  it('rejects the request when a frame write fails', async () => {
    const client = new RpcClient({
      mtu: 23,
      writeFrame: async () => {
        throw new Error('GATT operation failed');
      },
    });
    await expect(client.request({ method: 'POST', path: SPIKE_PATHS.echo })).rejects.toThrow(
      'GATT',
    );
  });
});

describe('zlibGzip', () => {
  it('stops at the output limit', async () => {
    const bomb = await zlibGzip.compress(new Uint8Array(1_000_000));
    await expect(zlibGzip.decompress(bomb, 10_000)).rejects.toMatchObject({
      code: 'MESSAGE_TOO_LARGE',
    });
  });

  it('reports corrupt input', async () => {
    await expect(zlibGzip.decompress(new Uint8Array([1, 2, 3]), 10)).rejects.toMatchObject({
      code: 'DECOMPRESSION_FAILED',
    });
  });
});
