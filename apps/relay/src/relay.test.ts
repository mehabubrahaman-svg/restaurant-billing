import { RELAY_SIGNATURE_HEADER, type RelayToHub } from '@restroos/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildRelay, signature } from './app';
import { RelayStore } from './store';

const NAAN = '0c200000-0000-4000-8000-000000000001';
const order = (externalOrderId: string) => ({
  event: 'order.created',
  order: {
    channel: 'swiggy',
    externalOrderId,
    otp: '4821',
    items: [{ menuItemId: NAAN, quantity: 2 }],
  },
});

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function relay(middlewareStatus = 200) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-'));
  const store = new RelayStore(join(dir, 'relay.db'));
  const hub = store.addHub({
    name: 'Park Street',
    middlewareUrl: 'https://middleware.test/restroos/',
    middlewareKey: 'mw-key',
  });
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return new Response(null, { status: middlewareStatus });
  }) as unknown as typeof fetch;
  const { app, forwardDue, connected } = buildRelay({ store, fetch: fakeFetch });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const sockets: WebSocket[] = [];
  cleanup = async () => {
    for (const ws of sockets) ws.terminate();
    await app.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  const post = (body: unknown, opts: { hubId?: string; secret?: string; raw?: string } = {}) => {
    const raw = opts.raw ?? JSON.stringify(body);
    return app.inject({
      method: 'POST',
      url: `/webhooks/${opts.hubId ?? hub.id}`,
      headers: {
        'content-type': 'application/json',
        [RELAY_SIGNATURE_HEADER]: signature(opts.secret ?? hub.webhookSecret, raw),
      },
      payload: raw,
    });
  };
  /** The Hub's side: connects, and collects what the relay sends. */
  const connect = (key = hub.key) =>
    new Promise<{ ws: WebSocket; received: RelayToHub[]; next: () => Promise<RelayToHub> }>(
      (resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/hub?hub=${hub.id}`, {
          headers: { authorization: `Bearer ${key}` },
        });
        sockets.push(ws);
        const received: RelayToHub[] = [];
        const waiting: ((m: RelayToHub) => void)[] = [];
        ws.on('message', (data) => {
          const m = JSON.parse(String(data)) as RelayToHub;
          const w = waiting.shift();
          if (w) w(m);
          else received.push(m);
        });
        const next = () =>
          new Promise<RelayToHub>((r) => {
            const queued = received.shift();
            if (queued) r(queued);
            else waiting.push(r);
          });
        ws.once('open', () => resolve({ ws, received, next }));
        ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
        ws.once('error', reject);
      },
    );
  return { store, hub, post, connect, forwardDue, connected, calls };
}

describe('relay', () => {
  it('keeps signed webhooks until the Hub acknowledges them, once each', async () => {
    const { store, hub, post, connect, connected } = await relay();

    expect((await post(order('SWG-1'), { secret: 'wrong' })).statusCode).toBe(401);
    expect((await post(order('SWG-1'), { hubId: '0' })).statusCode).toBe(404);
    expect((await post(null, { raw: '{not json' })).statusCode).toBe(400);
    expect((await post({ event: 'order.created', order: { channel: 'swiggy' } })).statusCode).toBe(
      422,
    );

    // The Hub is away: the order waits.
    const first = await post(order('SWG-1'));
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ status: 'PENDING' });
    // The middleware retries: still one order.
    expect((await post(order('SWG-1'))).json().id).toBe(first.json().id);

    await expect(connect('not-the-key')).rejects.toThrow('HTTP 401');
    const hubSide = await connect();
    expect(connected(hub.id)).toBe(true);
    const delivered = await hubSide.next();
    expect(delivered).toEqual({
      type: 'deliver',
      id: first.json().id,
      message: {
        event: 'order.created',
        order: {
          channel: 'SWIGGY',
          externalOrderId: 'SWG-1',
          otp: '4821',
          items: [{ menuItemId: NAAN, quantity: 2, addons: [] }],
        },
      },
    });
    hubSide.ws.send(JSON.stringify({ type: 'ack', id: first.json().id, ok: true }));

    // While connected, a new webhook goes straight through.
    const second = await post({
      event: 'order.cancelled',
      order: { channel: 'SWIGGY', externalOrderId: 'SWG-1', reason: 'Customer cancelled' },
    });
    expect(await hubSide.next()).toMatchObject({ type: 'deliver', id: second.json().id });
    hubSide.ws.send(
      JSON.stringify({ type: 'ack', id: second.json().id, ok: false, error: 'already billed' }),
    );
    await expect.poll(() => store.inbox(second.json().id)?.status).toBe('FAILED');
    expect(store.inbox(first.json().id)).toMatchObject({ status: 'DONE' });
    expect(store.inbox(second.json().id)?.error).toBe('already billed');
    expect(store.pendingFor(hub.id)).toEqual([]);
  });

  it('stores what the Hub sends and forwards it to the middleware, retrying failures', async () => {
    const ok = await relay();
    const hubSide = await ok.connect();
    hubSide.ws.send(
      JSON.stringify({ type: 'send', id: 'menu-0001', kind: 'menu', payload: { items: [] } }),
    );
    expect(await hubSide.next()).toEqual({ type: 'stored', id: 'menu-0001' });
    await expect.poll(() => ok.store.outbox('menu-0001')?.status).toBe('SENT');
    expect(ok.calls).toEqual([
      {
        url: 'https://middleware.test/restroos/menu',
        headers: expect.objectContaining({
          authorization: 'Bearer mw-key',
          'x-relay-hub': ok.hub.id,
          'idempotency-key': 'menu-0001',
        }),
        body: { items: [] },
      },
    ]);
    await cleanup?.();

    const down = await relay(503);
    const side = await down.connect();
    side.ws.send(
      JSON.stringify({
        type: 'send',
        id: 'status-0001',
        kind: 'order-status',
        payload: { channel: 'SWIGGY', externalOrderId: 'SWG-1', status: 'READY' },
      }),
    );
    expect(await side.next()).toEqual({ type: 'stored', id: 'status-0001' });
    await expect.poll(() => down.store.outbox('status-0001')?.attempts).toBe(1);
    expect(down.store.outbox('status-0001')).toMatchObject({
      status: 'PENDING',
      error: 'middleware answered 503',
    });
    // Not due again yet.
    expect(await down.forwardDue()).toBe(0);
  });
});
