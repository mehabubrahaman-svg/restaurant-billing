import type { Order } from '@restroos/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import { ITEM_NAAN, makeFloor, makeSnapshot, makeTable } from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { KOT_1, makeKotSummary, makeLine, makeOrder, ORDER_ID } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession, USER_ID } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';
import { useConnectionStore } from '../connection/connection-store';
import { MemoryCommandStore } from './command-store';
import { replayDelay, resetCommandQueue, useCommandQueue } from './command-queue';

const PERMISSIONS = ['tables.view', 'orders.create', 'orders.update', 'orders.fire_kot'];
let order: Order;
/** While true, every order command fails as if the Wi-Fi dropped. */
let down = false;

function unreachable(handler: Handler): Handler {
  return (request) => {
    if (down) throw new TypeError('Failed to fetch');
    return handler(request);
  };
}

function hub(routes: Record<string, Handler> = {}) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions: PERMISSIONS })),
    'GET /menu': () => json(makeSnapshot()),
    'GET /floor': () => json(makeFloor([makeTable({ status: 'OCCUPIED' })])),
    [`GET /orders/${ORDER_ID}`]: () => json(order),
    [`POST /orders/${ORDER_ID}/items`]: unreachable(({ body }) => {
      const { items } = body as { items: { quantity: number }[] };
      order = makeOrder({ items: [makeLine({ quantity: items[0]!.quantity })], version: 2 });
      return json(order);
    }),
    [`POST /orders/${ORDER_ID}/kots`]: unreachable(() => {
      const kot = makeKotSummary();
      order = makeOrder({
        items: order.items.map((i) => ({ ...i, status: 'SENT' as const, kotId: KOT_1 })),
        kots: [kot],
        version: 3,
      });
      return json({ order, kots: [kot] }, 201);
    }),
    ...routes,
  });
}

const commandCalls = (fetchMock: ReturnType<typeof mockHub>) =>
  fetchMock.mock.calls
    .map(([u, init]) => ({
      path: new URL(String(u), 'http://hub.test').pathname.replace('/api/v1', ''),
      method: init?.method ?? 'GET',
      key: new Headers(init?.headers).get('idempotency-key'),
    }))
    .filter((c) => c.method === 'POST' && c.path.startsWith('/orders/'));

const panel = () => screen.getByRole('region', { name: 'Order #142' });
const pill = () => screen.getAllByRole('status').find((el) => el.hasAttribute('data-status'))!;

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  useConnectionStore.setState({ consecutiveFailures: 0, hasConnected: false, queuedCount: 0 });
  order = makeOrder();
  down = false;
  await i18n.changeLanguage('en-IN');
});
afterEach(() => {
  act(() => window.dispatchEvent(new Event('online')));
  vi.unstubAllGlobals();
});

describe('Offline command queue', () => {
  it('backs off 2 s, 4 s, 8 s … up to 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(replayDelay)).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it('queues commands while the Hub is unreachable, shows them, and replays them in order', async () => {
    const fetchMock = hub();
    renderApp(`/captain/orders/${ORDER_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Breads' }));
    const naan = await screen.findByRole('button', { name: 'Add Butter Naan, ₹60.00' });

    down = true;
    act(() => window.dispatchEvent(new Event('offline')));
    fireEvent.click(naan);
    expect(await within(panel()).findByText('Queued: not on the Hub yet')).toBeInTheDocument();
    await waitFor(() => expect(pill()).toHaveTextContent('Offline1 queued'));

    // Firing while offline is allowed to queue, with a clear warning.
    fireEvent.click(within(panel()).getByRole('button', { name: 'Send to kitchen (1)' }));
    expect(await within(panel()).findByText('Kitchen not notified yet')).toBeInTheDocument();
    await waitFor(() => expect(pill()).toHaveTextContent('Offline2 queued'));
    expect(useCommandQueue.getState().commands.map((c) => c.kind)).toEqual(['addItems', 'fire']);
    await expectNoAxeViolations();

    // Back online: oldest first, each with the key it was queued with.
    down = false;
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(useCommandQueue.getState().commands).toHaveLength(0));
    expect(await within(panel()).findByRole('region', { name: 'KOT 31' })).toBeInTheDocument();
    expect(within(panel()).queryByText('Kitchen not notified yet')).toBeNull();

    const calls = commandCalls(fetchMock);
    const items = calls.filter((c) => c.path.endsWith('/items'));
    const fires = calls.filter((c) => c.path.endsWith('/kots'));
    // The add was tried once live (failed), then replayed with the same key.
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(new Set(items.map((c) => c.key)).size).toBe(1);
    expect(new Set(fires.map((c) => c.key)).size).toBe(1);
    const lastItems = calls.lastIndexOf(items.at(-1)!);
    const lastFire = calls.lastIndexOf(fires.at(-1)!);
    expect(lastItems).toBeLessThan(lastFire);
    expect(useConnectionStore.getState().queuedCount).toBe(0);
  });

  it('marks a replay the Hub refuses (4xx) as needing attention, then lets it be discarded', async () => {
    hub({
      [`POST /orders/${ORDER_ID}/items`]: unreachable(() => problem(409, 'ITEM_UNAVAILABLE')),
    });
    renderApp(`/captain/orders/${ORDER_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Breads' }));
    const naan = await screen.findByRole('button', { name: 'Add Butter Naan, ₹60.00' });
    down = true;
    fireEvent.click(naan);
    await within(panel()).findByText('Queued: not on the Hub yet');

    down = false;
    act(() => window.dispatchEvent(new Event('online')));
    const alert = await within(panel()).findByRole('alert');
    expect(alert).toHaveTextContent('Dishes not added: needs attention');
    expect(alert).toHaveTextContent('out of stock');
    expect(useCommandQueue.getState().commands[0]).toMatchObject({
      status: 'failed',
      error: { code: 'ITEM_UNAVAILABLE', status: 409 },
    });
    // Needs-attention commands don't count as queued in the pill.
    expect(useConnectionStore.getState().queuedCount).toBe(0);

    fireEvent.click(within(alert).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(useCommandQueue.getState().commands).toHaveLength(0));
    expect(within(panel()).queryByRole('alert')).toBeNull();
  });

  it('replays commands saved before a reload, as the user who queued them', async () => {
    const store = new MemoryCommandStore();
    await store.put({
      id: 'saved-key-0001',
      kind: 'addItems',
      orderId: ORDER_ID,
      method: 'POST',
      path: `/orders/${ORDER_ID}/items`,
      body: { items: [{ menuItemId: ITEM_NAAN, quantity: 3, addons: [] }] },
      userId: USER_ID,
      createdAt: Date.now() - 60_000,
      status: 'sending', // the tablet died mid-send
      attempts: 1,
      error: null,
      lines: [],
    });
    resetCommandQueue(store);
    const fetchMock = hub();
    renderApp(`/captain/orders/${ORDER_ID}`);
    await waitFor(() => expect(useCommandQueue.getState().commands).toHaveLength(0));
    const [replay] = commandCalls(fetchMock);
    expect(replay).toEqual({
      path: `/orders/${ORDER_ID}/items`,
      method: 'POST',
      key: 'saved-key-0001',
    });
    expect(await store.list()).toEqual([]);
    expect(
      await within(await screen.findByRole('region', { name: 'Order #142' })).findByRole('button', {
        name: 'Send to kitchen (3)',
      }),
    ).toBeInTheDocument();
  });
});
