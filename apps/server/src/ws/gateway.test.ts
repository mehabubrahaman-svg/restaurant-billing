import {
  FireKotsResponseSchema,
  OrderSchema,
  PairDeviceResponseSchema,
  PairingCodeResponseSchema,
  type ServerControl,
  type ServerMessage,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { restaurantServer } from '../testing/restaurant';
import { signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';
import { WsGateway } from './gateway';

type Received = ServerMessage | ServerControl;
let s: TestServer | undefined;
let gateway: WsGateway | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  gateway?.close();
  await s?.close();
});

async function live() {
  const r = await restaurantServer();
  s = r.s;
  gateway = new WsGateway(r.s.container.cradle, r.s.container.cradle.logger);
  await r.s.app.listen({ host: '127.0.0.1', port: 0 });
  gateway.attach(r.s.app.server);
  const port = (r.s.app.server.address() as { port: number }).port;

  /** Opens a socket and collects every message. */
  const connect = async (
    auth: { token: string | null } | null,
    headers: Record<string, string> = {},
  ) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    sockets.push(ws);
    const inbox: Received[] = [];
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('message', (data) => inbox.push(JSON.parse(data.toString()) as Received));
    await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
    if (auth) ws.send(JSON.stringify({ type: 'auth', token: auth.token }));
    const waitFor = async (pred: (m: Received) => boolean, ms = 2000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const found = inbox.find(pred);
        if (found) return found;
        await new Promise((res) => setTimeout(res, 10));
      }
      throw new Error(`timed out; got ${inbox.map((m) => m.type).join(', ')}`);
    };
    return { ws, inbox, closed, waitFor, send: (m: object) => ws.send(JSON.stringify(m)) };
  };
  return { ...r, connect };
}

describe('WebSocket gateway', () => {
  it('needs auth first and sends topics by permission', async () => {
    const { connect, admin, s } = await live();
    const anonymous = await connect(null);
    anonymous.send({ type: 'ping' });
    expect(await anonymous.closed).toBe(4401);

    const bad = await connect({ token: 'not-a-token' });
    expect(await bad.closed).toBe(4401);

    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');
    void captain;
    const session = await s.login('rahul', 'Staff#Pass2026');
    const c = await connect({ token: session.accessToken });
    const hello = (await c.waitFor((m) => m.type === 'hello')) as Extract<
      ServerControl,
      { type: 'hello' }
    >;
    expect(hello.topics.sort()).toEqual(['floor', 'tokens']);
  });

  it('pushes a fired order to the kitchen and the ready status back to the floor, once per entity', async () => {
    const { connect, admin, menu, tables, openAt, s } = await live();
    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');
    const chef = await signInAs(s, admin, 'KITCHEN', 'chef.bose');
    const floorWs = await connect({
      token: (await s.login('rahul', 'Staff#Pass2026')).accessToken,
    });
    const kdsWs = await connect({
      token: (await s.login('chef.bose', 'Staff#Pass2026')).accessToken,
    });
    await floorWs.waitFor((m) => m.type === 'hello');
    await kdsWs.waitFor((m) => m.type === 'hello');

    const order = await openAt(captain, tables.t1.id);
    await floorWs.waitFor((m) => m.type === 'floor.table.status_changed');
    await captain('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 2 }],
    });
    const fired = FireKotsResponseSchema.parse(
      (await captain('POST', `/orders/${order.id}/kots`)).json(),
    );

    const firedMsg = await kdsWs.waitFor((m) => m.type === 'kitchen.kot.fired');
    expect(firedMsg).toMatchObject({
      data: { kot: { kotNo: 1, tableLabel: 'T1', items: [{ name: 'Butter Naan', quantity: 2 }] } },
    });
    // The kitchen doesn't get floor messages; the floor doesn't get the fired card.
    expect(kdsWs.inbox.some((m) => m.type === 'ordering.order.updated')).toBe(false);
    expect(floorWs.inbox.some((m) => m.type === 'kitchen.kot.fired')).toBe(false);
    // At most one order update per command (open, add items, fire), never one per event;
    // back-to-back commands may coalesce into fewer.
    await new Promise((r) => setTimeout(r, 50));
    const updates = floorWs.inbox.filter((m) => m.type === 'ordering.order.updated');
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates.length).toBeLessThanOrEqual(3);
    expect(updates.at(-1)).toMatchObject({ data: { order: { pendingCount: 0, itemCount: 2 } } });

    await chef('POST', `/kitchen/kots/${fired.kots[0]!.id}/status`, {
      to: 'READY',
      version: fired.kots[0]!.version,
    });
    const ready = await floorWs.waitFor((m) => m.type === 'kitchen.kot.status_changed');
    expect(ready).toMatchObject({ data: { from: 'NEW', to: 'READY', kot: { orderId: order.id } } });
    const refreshed = (await floorWs.waitFor(
      (m) => m.type === 'ordering.order.updated' && m.data.order.readyCount === 2,
    )) as Extract<ServerMessage, { type: 'ordering.order.updated' }>;
    expect(refreshed.data.order.id).toBe(order.id);
    expect(refreshed.seq).toBeGreaterThan(
      updates.at(-1)!.type === 'ordering.order.updated' ? updates.at(-1)!.seq : 0,
    );
  });

  it('replays what a reconnecting client missed, or asks it to resync', async () => {
    const { connect, admin, menu, tables, openAt, ok, s } = await live();
    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');
    const token = (await s.login('rahul', 'Staff#Pass2026')).accessToken;
    const first = await connect({ token });
    const hello = (await first.waitFor((m) => m.type === 'hello')) as Extract<
      ServerControl,
      { type: 'hello' }
    >;
    first.ws.terminate();

    const order = await openAt(captain, tables.t1.id);
    await ok(
      captain('POST', `/orders/${order.id}/items`, {
        items: [{ menuItemId: menu.naan.id, quantity: 1 }],
      }),
      OrderSchema,
    );

    const again = await connect({ token });
    await again.waitFor((m) => m.type === 'hello');
    again.send({ type: 'resume', lastSeq: hello.seq });
    const replayed = (await again.waitFor((m) => m.type === 'ordering.order.updated')) as Extract<
      ServerMessage,
      { type: 'ordering.order.updated' }
    >;
    expect(replayed.data.order).toMatchObject({ id: order.id, itemCount: 1 });
    expect(again.inbox.filter((m) => m.type === 'ordering.order.updated')).toHaveLength(1);
    await again.waitFor((m) => m.type === 'floor.table.status_changed');

    again.send({ type: 'resume', lastSeq: hello.seq + 1_000_000 });
    expect(await again.waitFor((m) => m.type === 'resync')).toMatchObject({
      reason: 'history changed',
    });
  });

  it('lets a paired token display listen without anyone signed in', async () => {
    const { connect, admin, menu, s, ok } = await live();
    const code = PairingCodeResponseSchema.parse(
      (
        await admin('POST', '/devices/pairing-codes', { name: 'Token TV', kind: 'TOKEN_DISPLAY' })
      ).json(),
    );
    const paired = PairDeviceResponseSchema.parse(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/devices/pair',
          payload: { code: code.code, fingerprint: 't'.repeat(32) },
        })
      ).json(),
    );
    const tv = await connect({ token: null }, { cookie: `restro_dt=${paired.deviceToken}` });
    const hello = (await tv.waitFor((m) => m.type === 'hello')) as Extract<
      ServerControl,
      { type: 'hello' }
    >;
    expect(hello.topics).toEqual(['tokens']);

    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');
    const chef = await signInAs(s, admin, 'KITCHEN', 'chef.bose');
    const takeaway = await ok(captain('POST', '/orders', { orderType: 'TAKEAWAY' }), OrderSchema);
    await captain('POST', `/orders/${takeaway.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    const fired = FireKotsResponseSchema.parse(
      (await captain('POST', `/orders/${takeaway.id}/kots`)).json(),
    );
    await chef('POST', `/kitchen/kots/${fired.kots[0]!.id}/status`, {
      to: 'READY',
      version: fired.kots[0]!.version,
    });
    expect(await tv.waitFor((m) => m.type === 'token.ready')).toMatchObject({
      data: { tokenNo: 1, orderId: takeaway.id },
    });
    expect(tv.inbox.every((m) => m.type === 'hello' || m.type === 'token.ready')).toBe(true);

    const nobody = await connect({ token: null });
    expect(await nobody.closed).toBe(4401);
  });

  it('flags a KOT once when it passes its target time', async () => {
    const { connect, admin, menu, tables, openAt, s } = await live();
    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');
    await signInAs(s, admin, 'KITCHEN', 'chef.bose');
    const kds = await connect({
      token: (await s.login('chef.bose', 'Staff#Pass2026')).accessToken,
    });
    await kds.waitFor((m) => m.type === 'hello');
    const order = await openAt(captain, tables.t1.id);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    const fired = FireKotsResponseSchema.parse(
      (await captain('POST', `/orders/${order.id}/kots`)).json(),
    );

    gateway!.scanDelays();
    s.clock.advance(6 * 60_000); // naan's target is 5 minutes
    gateway!.scanDelays();
    gateway!.scanDelays();
    const delayed = await kds.waitFor((m) => m.type === 'kitchen.kot.delayed');
    expect(delayed).toMatchObject({ data: { kotId: fired.kots[0]!.id, overdueSeconds: 60 } });
    expect(kds.inbox.filter((m) => m.type === 'kitchen.kot.delayed')).toHaveLength(1);
  });
});
