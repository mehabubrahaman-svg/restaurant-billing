import {
  OrderSchema,
  RELAY_SIGNATURE_HEADER,
  RelayOverviewSchema,
  type RelayOverview,
} from '@restroos/contracts';
import { buildRelay, RelayStore, signature } from '@restroos/relay';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
let stopRelay: (() => Promise<void>) | undefined;
afterEach(async () => {
  await s?.close();
  await stopRelay?.();
  s = undefined;
  stopRelay = undefined;
});

const POLL = { timeout: 5_000, interval: 50 };

/** A real relay on a local port, with the middleware's side faked. */
async function relay() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-'));
  const store = new RelayStore(join(dir, 'relay.db'));
  const creds = store.addHub({ name: 'Park Street', middlewareUrl: 'https://mw.test/rs' });
  const sent: { kind: string; body: Record<string, unknown> }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent.push({ kind: url.split('/').pop()!, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const { app } = buildRelay({ store, fetch: fakeFetch });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  stopRelay = async () => {
    await app.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  const webhook = async (body: object) => {
    const raw = JSON.stringify(body);
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/${creds.id}`,
      headers: {
        'content-type': 'application/json',
        [RELAY_SIGNATURE_HEADER]: signature(creds.webhookSecret, raw),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(202);
    return res.json().id as string;
  };
  return { store, creds, url: `http://127.0.0.1:${port}`, webhook, sent };
}

describe('online orders through the relay', () => {
  it('enters platform orders, sends them to the kitchen, and reports back', async () => {
    const r = await restaurantServer();
    s = r.s;
    const { admin, menu } = r;
    const net = await relay();
    await admin('POST', '/sales-channels', {
      code: 'swiggy',
      name: 'Swiggy',
      commissionBp: 2200,
      priceMarkupBp: 1000,
    });

    const saved = await admin('PUT', '/integrations/relay', {
      relayUrl: net.url,
      hubId: net.creds.id,
      hubKey: net.creds.key,
      isEnabled: true,
    });
    expect(saved.json().link).toEqual({
      relayUrl: net.url,
      hubId: net.creds.id,
      keySet: true,
      isEnabled: true,
      version: 1,
    });
    expect(saved.body).not.toContain(net.creds.key);
    const overview = async (): Promise<RelayOverview> =>
      RelayOverviewSchema.parse((await admin('GET', '/integrations/relay')).json());
    await expect.poll(async () => (await overview()).status.state, POLL).toBe('CONNECTED');

    // Swiggy sends an order: it is entered and sent to the kitchen.
    const created = await net.webhook({
      event: 'order.created',
      order: {
        channel: 'SWIGGY',
        externalOrderId: 'SWG-77',
        otp: '4821',
        note: 'ring the bell',
        items: [{ menuItemId: menu.naan.id, quantity: 2, note: 'extra butter' }],
      },
    });
    await expect.poll(() => net.store.inbox(created)?.status, POLL).toBe('DONE');
    const entered = (await overview()).recent.find((m) => m.id === created)!;
    expect(entered).toMatchObject({ direction: 'IN', status: 'DONE', externalOrderId: 'SWG-77' });
    const order = OrderSchema.parse((await admin('GET', `/orders/${entered.orderId}`)).json());
    expect(order).toMatchObject({
      orderType: 'DELIVERY',
      externalOrderId: 'SWG-77',
      salesChannelName: 'Swiggy',
      captainName: 'Online orders',
      notes: 'ring the bell',
    });
    expect(order.items).toEqual([
      expect.objectContaining({ quantity: 2, specialNote: 'extra butter', status: 'SENT' }),
    ]);
    expect(order.kots).toHaveLength(1);
    await expect
      .poll(() => net.sent.find((m) => m.kind === 'order-status')?.body, POLL)
      .toEqual({ channel: 'SWIGGY', externalOrderId: 'SWG-77', status: 'ACCEPTED' });
    // The "Online orders" user is not staff.
    expect(
      (await admin('GET', '/users')).json().data.map((u: { username: string }) => u.username),
    ).not.toContain('online-orders');

    // The middleware sends it again: still one order.
    expect(
      await net.webhook({
        event: 'order.created',
        order: {
          channel: 'SWIGGY',
          externalOrderId: 'SWG-77',
          items: [{ menuItemId: menu.naan.id, quantity: 2 }],
        },
      }),
    ).toBe(created);

    // The kitchen marks it ready: the platform hears.
    const kot = order.kots[0]!;
    for (const [to, version] of [
      ['ACCEPTED', kot.version],
      ['READY', kot.version + 1],
    ] as const) {
      expect(
        (await admin('POST', `/kitchen/kots/${kot.id}/status`, { to, version })).statusCode,
      ).toBe(200);
    }
    await expect
      .poll(
        () => net.sent.filter((m) => m.kind === 'order-status').map((m) => m.body['status']),
        POLL,
      )
      .toEqual(['ACCEPTED', 'READY']);

    // The platform cancels it: the Hub cancels the order.
    const cancelled = await net.webhook({
      event: 'order.cancelled',
      order: { channel: 'SWIGGY', externalOrderId: 'SWG-77', reason: 'Customer cancelled' },
    });
    await expect.poll(() => net.store.inbox(cancelled)?.status, POLL).toBe('DONE');
    expect((await admin('GET', `/orders/${order.id}`)).json()).toMatchObject({
      status: 'CANCELLED',
    });

    // Menu and availability go out.
    expect((await admin('POST', '/integrations/relay/menu')).statusCode).toBe(202);
    await expect.poll(() => net.sent.some((m) => m.kind === 'menu'), POLL).toBe(true);
    const pushed = net.sent.find((m) => m.kind === 'menu')!.body as {
      channels: { code: string }[];
      items: { id: string; price: number }[];
    };
    expect(pushed.channels).toEqual([{ code: 'SWIGGY', priceMarkupBp: 1000 }]);
    expect(pushed.items.find((i) => i.id === menu.naan.id)).toMatchObject({
      price: menu.naan.basePrice,
    });
    await admin('POST', `/menu-items/${menu.naan.id}/availability`, { isAvailable: false });
    await expect
      .poll(() => net.sent.find((m) => m.kind === 'availability')?.body, POLL)
      .toEqual({ items: [{ menuItemId: menu.naan.id, available: false }] });
    await expect.poll(async () => (await overview()).counts.pendingOut, POLL).toBe(0);
  });

  it('keeps an order it can’t enter for staff, and tries it again once fixed', async () => {
    const r = await restaurantServer();
    s = r.s;
    const { admin, menu } = r;
    const net = await relay();
    const cashier = await signInAs(r.s, admin, 'CASHIER', 'meera');
    expect((await cashier('GET', '/integrations/relay')).statusCode).toBe(403);
    expect(
      (
        await admin('PUT', '/integrations/relay', {
          relayUrl: net.url,
          hubId: net.creds.id,
          isEnabled: true,
        })
      ).json().code,
    ).toBe('VALIDATION_FAILED');
    await admin('PUT', '/integrations/relay', {
      relayUrl: net.url,
      hubId: net.creds.id,
      hubKey: net.creds.key,
      isEnabled: true,
    });
    const overview = async () =>
      RelayOverviewSchema.parse((await admin('GET', '/integrations/relay')).json());
    await expect.poll(async () => (await overview()).status.state, POLL).toBe('CONNECTED');

    // No Zomato channel on the Hub yet.
    const id = await net.webhook({
      event: 'order.created',
      order: {
        channel: 'ZOMATO',
        externalOrderId: 'ZMT-5',
        items: [{ menuItemId: menu.naan.id, quantity: 1 }],
      },
    });
    await expect.poll(() => net.store.inbox(id)?.status, POLL).toBe('FAILED');
    const failed = await overview();
    expect(failed.counts.failedIn).toBe(1);
    expect(failed.recent[0]).toMatchObject({
      status: 'FAILED',
      error: 'no active aggregator channel ZOMATO on the Hub',
    });

    await admin('POST', '/sales-channels', { code: 'zomato', name: 'Zomato', commissionBp: 2000 });
    expect((await admin('POST', `/integrations/relay/messages/${id}/retry`)).json()).toEqual({
      ok: true,
    });
    expect((await overview()).counts.failedIn).toBe(0);

    // A wrong key: the Hub says so instead of connecting.
    const again = await overview();
    await admin('PUT', '/integrations/relay', {
      relayUrl: net.url,
      hubId: net.creds.id,
      hubKey: 'not-the-right-key-at-all',
      isEnabled: true,
      version: again.link!.version,
    });
    await expect
      .poll(async () => (await overview()).status.lastError, POLL)
      .toBe('the relay refused the hub id or key');
  });
});
