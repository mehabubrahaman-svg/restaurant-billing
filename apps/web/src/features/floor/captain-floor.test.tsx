import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { LONG_PRESS_MS } from '../../portals/captain/captain-page';
import {
  makeFloor,
  makeSnapshot,
  makeTable,
  TABLE_T1,
  TABLE_T2,
} from '../../test/catalog-fixtures';
import { FakeSocket } from '../../test/fake-socket';
import { envelope, makeOrder, summaryOf } from '../../test/order-fixtures';
import { BASE_ROUTES, json, mockHub } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

const floor = () =>
  makeFloor([
    makeTable({ status: 'RESERVED' }),
    makeTable({ id: TABLE_T2, label: 'T2', posX: 10, status: 'OCCUPIED' }),
  ]);

describe('Captain floor', () => {
  it('colours tables by status with icon and text, and offers only allowed changes', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () =>
        json(makeSession({ permissions: ['tables.view', 'tables.update_status'] })),
      'GET /floor': () => json(floor()),
      [`POST /tables/${TABLE_T1}/status`]: () => json(makeTable({ status: 'BLOCKED', version: 2 })),
    });
    renderApp('/captain');
    const t1 = await screen.findByRole('button', { name: 'Table T1, 4 seats, Reserved' });
    expect(t1).toHaveAttribute('data-status', 'RESERVED');
    expect(screen.getByRole('list', { name: 'Table status' })).toHaveTextContent('Reserved');

    fireEvent.click(t1);
    const sheet = await screen.findByRole('dialog', { name: 'Table T1' });
    const options = within(sheet)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('data-status'))
      .map((b) => b.textContent);
    expect(options).toEqual(['Mark free', 'Block table']);
    // No orders.create: the sheet offers no order.
    expect(within(sheet).queryByRole('button', { name: 'Take order' })).toBeNull();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Block table' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith(`/tables/${TABLE_T1}/status`),
    )!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ status: 'BLOCKED', version: 1 });
    expect(
      await screen.findByRole('button', { name: 'Table T1, 4 seats, Blocked' }),
    ).toBeInTheDocument();
  });

  it('leaves order-driven statuses alone and hides changes without permission', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['tables.view'] })),
      'GET /floor': () => json(floor()),
    });
    renderApp('/captain');
    fireEvent.click(await screen.findByRole('button', { name: 'Table T2, 4 seats, Occupied' }));
    const sheet = await screen.findByRole('dialog', { name: 'Table T2' });
    expect(within(sheet).getByText('Your role cannot change table status.')).toBeInTheDocument();
    expect(
      within(sheet)
        .queryAllByRole('button')
        .filter((b) => b.hasAttribute('data-status')),
    ).toHaveLength(0);
  });
});

describe('Captain floor with orders', () => {
  const ME = makeSession().user.id;
  const OTHER = '99999999-9999-4999-8999-999999999999';
  const ORDER = '0a000000-0000-4000-8000-000000000001';
  const NEW_ORDER = '0a000000-0000-4000-8000-000000000009';
  const PERMS = ['tables.view', 'tables.update_status', 'orders.create', 'orders.update'];
  const openedAt = new Date(Date.now() - 32 * 60_000).toISOString();
  const tableOrder = (captainId: string, overrides = {}) => ({
    id: ORDER,
    orderNo: '142',
    covers: 4,
    subtotal: 234000,
    openedAt,
    captainId,
    captainName: captainId === ME ? 'Ravi Kumar' : 'Priya Ghosh',
    itemCount: 6,
    pendingCount: 0,
    readyCount: 2,
    ...overrides,
  });
  const liveFloor = () =>
    makeFloor([
      makeTable(),
      makeTable({
        id: TABLE_T2,
        label: 'T2',
        posX: 10,
        status: 'OCCUPIED',
        currentOrderId: ORDER,
        openOrder: tableOrder(ME),
      }),
      makeTable({
        id: 'f1000000-0000-4000-8000-000000000003',
        label: 'T3',
        posX: 20,
        status: 'OCCUPIED',
        currentOrderId: '0a000000-0000-4000-8000-000000000003',
        openOrder: tableOrder(OTHER, { id: '0a000000-0000-4000-8000-000000000003', readyCount: 0 }),
      }),
    ]);

  it('shows elapsed time, guests, amount and ready dishes, and filters All / Mine / Free', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: PERMS })),
      'GET /floor': () => json(liveFloor()),
      'GET /orders': () => json({ data: [] }),
    });
    renderApp('/captain');
    const t2 = await screen.findByRole('button', {
      name: 'Table T2, Occupied, open 32 minutes, ₹2,340.00, 2 dishes ready',
    });
    expect(t2).toHaveTextContent('4 guests');
    expect(t2).toHaveTextContent('32m');
    expect(t2).toHaveTextContent('2 ready');

    const tiles = () =>
      screen.getAllByRole('button').filter((b) => b.hasAttribute('data-status')).length;
    expect(tiles()).toBe(3);
    fireEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(tiles()).toBe(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Free' }));
    expect(tiles()).toBe(1);
    expect(screen.getByRole('button', { name: 'Table T1, 4 seats, Free' })).toBeInTheDocument();
  });

  it('asks for guests on a free table, opens the order and goes to the pad', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: PERMS })),
      'GET /floor': () => json(liveFloor()),
      'GET /orders': () => json({ data: [] }),
      'GET /menu': () => json(makeSnapshot()),
      'POST /orders': ({ body }) =>
        json(
          makeOrder({
            id: NEW_ORDER,
            orderNo: '143',
            covers: (body as { covers: number }).covers,
          }),
          201,
        ),
      [`GET /orders/${NEW_ORDER}`]: () => json(makeOrder({ id: NEW_ORDER, orderNo: '143' })),
    });
    const { router } = renderApp('/captain');
    fireEvent.click(await screen.findByRole('button', { name: 'Table T1, 4 seats, Free' }));
    const dialog = await screen.findByRole('dialog', { name: 'Table T1: how many guests?' });
    expect(within(dialog).getByRole('radio', { name: '4' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: '2' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start order' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/captain/orders/${NEW_ORDER}`),
    );
    const post = fetchMock.mock.calls.find(
      ([u, init]) => String(u).endsWith('/orders') && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      orderType: 'DINE_IN',
      tableId: TABLE_T1,
      covers: 2,
    });
    expect(new Headers(post[1]?.headers).get('idempotency-key')).not.toBeNull();
    expect(await screen.findByRole('heading', { name: 'T1 · Order #143' })).toBeInTheDocument();
  });

  it('opens an occupied table’s order on tap, and its actions on long-press', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () =>
        json(makeSession({ permissions: [...PERMS, 'orders.transfer_table'] })),
      'GET /floor': () => json(liveFloor()),
      'GET /orders': () => json({ data: [] }),
      'GET /menu': () => json(makeSnapshot()),
      [`GET /orders/${ORDER}`]: () => json(makeOrder({ tableId: TABLE_T2, tableLabel: 'T2' })),
    });
    const { router } = renderApp('/captain');
    const t2 = await screen.findByRole('button', { name: /^Table T2, Occupied/ });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.pointerDown(t2, { button: 0 });
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      fireEvent.pointerUp(t2);
      fireEvent.click(t2);
    } finally {
      vi.useRealTimers();
    }
    const sheet = await screen.findByRole('dialog', { name: 'Table T2' });
    expect(within(sheet).getByRole('button', { name: 'Move table' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Merge tables' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/captain');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: /^Table T2, Occupied/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/captain/orders/${ORDER}`));
  });

  it('starts a takeaway order straight away', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: PERMS })),
      'GET /floor': () => json(liveFloor()),
      'GET /orders': () => json({ data: [] }),
      'GET /menu': () => json(makeSnapshot()),
      'POST /orders': () =>
        json(
          makeOrder({
            id: NEW_ORDER,
            orderType: 'TAKEAWAY',
            tableId: null,
            tableLabel: null,
            tokenNo: 12,
          }),
          201,
        ),
      [`GET /orders/${NEW_ORDER}`]: () =>
        json(
          makeOrder({
            id: NEW_ORDER,
            orderType: 'TAKEAWAY',
            tableId: null,
            tableLabel: null,
            tokenNo: 12,
          }),
        ),
    });
    const { router } = renderApp('/captain');
    fireEvent.click(await screen.findByRole('button', { name: 'Takeaway' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/captain/orders/${NEW_ORDER}`),
    );
    const post = fetchMock.mock.calls.find(
      ([u, init]) => String(u).endsWith('/orders') && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ orderType: 'TAKEAWAY' });
    expect(
      await screen.findByRole('heading', { name: 'Takeaway · Token 12 · #142' }),
    ).toBeInTheDocument();
  });

  it('updates tiles from live messages', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: PERMS })),
      'GET /floor': () => json(liveFloor()),
      'GET /orders': () => json({ data: [] }),
    });
    renderApp('/captain');
    await screen.findByRole('button', { name: 'Table T1, 4 seats, Free' });
    const ws = FakeSocket.last;
    act(() => {
      ws.open();
      ws.receive({ type: 'hello', seq: 1, topics: ['floor'] });
    });
    expect(ws.sent[0]).toEqual({ type: 'auth', token: 'access-1' });
    const opened = makeOrder({ id: NEW_ORDER, orderNo: '150', covers: 3, items: [] });
    act(() => {
      ws.receive(
        envelope('floor.table.status_changed', {
          tableId: TABLE_T1,
          status: 'OCCUPIED',
          orderId: NEW_ORDER,
          version: 2,
        }),
      );
      ws.receive(envelope('ordering.order.updated', { order: summaryOf(opened) }));
    });
    const t1 = await screen.findByRole('button', { name: /^Table T1, Occupied/ });
    expect(t1).toHaveTextContent('3 guests');
    expect(t1).toHaveTextContent('₹0.00');
  });
});
