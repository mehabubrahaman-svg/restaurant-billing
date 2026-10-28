import type { Order } from '@restroos/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../features/auth/auth-store';
import { i18n } from '../../../i18n';
import { chime } from '../../../lib/chime';
import { useSoundStore } from '../../../stores/sound-store';
import { expectNoAxeViolations } from '../../../test/axe';
import {
  ADDON_EXTRAS,
  addonGroups,
  ITEM_BIRYANI,
  ITEM_NAAN,
  makeFloor,
  makeItem,
  makeSnapshot,
  makeTable,
  naan,
  VARIANT_HALF,
} from '../../../test/catalog-fixtures';
import { FakeSocket } from '../../../test/fake-socket';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../../test/mock-hub';
import {
  envelope,
  KOT_1,
  LINE_1,
  makeKot,
  makeKotSummary,
  makeLine,
  makeOrder,
  ORDER_ID,
} from '../../../test/order-fixtures';
import { renderApp } from '../../../test/render-app';
import { makeSession, USER_ID } from '../../../test/session';

vi.mock('../../../lib/chime', () => ({
  chime: vi.fn(),
  unlockAudio: vi.fn(async () => false),
  audioReady: () => false,
}));

const MANAGER = '55555555-5555-4555-8555-555555555555';
const RAITA = addonGroups[0]!.addons[0]!.id;
const PERMISSIONS = ['tables.view', 'orders.create', 'orders.update', 'orders.fire_kot'];

const soldOut = makeItem({
  id: 'b0000000-0000-4000-8000-000000000003',
  sku: 'BIR-MUT',
  name: 'Mutton Biryani',
  nameTranslations: {},
  variants: [],
  basePrice: 42000,
  isAvailable: false,
});

/** Biryani with sizes and one add-on group (pick at most 1); naan is a plain dish. */
function snapshot() {
  const snap = makeSnapshot([
    makeItem({ addonGroupIds: [ADDON_EXTRAS] }),
    { ...naan, categoryId: makeItem().categoryId },
    soldOut,
  ]);
  return { ...snap, addonGroups: [{ ...addonGroups[0]!, maxSelect: 1 }] };
}

let order: Order;

function hub(routes: Record<string, Handler> = {}, permissions = PERMISSIONS) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /menu': () => json(snapshot()),
    'GET /floor': () => json(makeFloor([makeTable({ status: 'OCCUPIED' })])),
    [`GET /orders/${ORDER_ID}`]: () => json(order),
    ...routes,
  });
}

const callsTo = (fetchMock: ReturnType<typeof mockHub>, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) =>
      new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
      (init?.method ?? 'GET') === method,
  );
const bodyOf = (call: unknown[]) =>
  JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
const headerOf = (call: unknown[], name: string) =>
  new Headers((call[1] as RequestInit).headers).get(name);

const panel = () => screen.getByRole('region', { name: 'Order #142' });

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  useSoundStore.setState({ muted: false });
  vi.mocked(chime).mockClear();
  order = makeOrder();
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Order pad', () => {
  it('adds a plain dish per tap, batching taps into one request; 86’d dishes can’t be tapped', async () => {
    const fetchMock = hub({
      [`POST /orders/${ORDER_ID}/items`]: ({ body }) => {
        const [item] = (body as { items: { quantity: number }[] }).items;
        order = makeOrder({ items: [makeLine({ quantity: item!.quantity })], version: 2 });
        return json(order);
      },
    });
    renderApp(`/captain/orders/${ORDER_ID}`);
    const naanTile = await screen.findByRole('button', { name: 'Add Butter Naan, ₹60.00' });
    expect(screen.getByRole('button', { name: 'Mutton Biryani: out of stock' })).toBeDisabled();

    fireEvent.click(naanTile);
    fireEvent.click(naanTile);
    // Shown at once, before the Hub has it.
    expect(within(panel()).getByText('Butter Naan')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Send to kitchen (2)' })).toBeEnabled();

    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/items`)).toHaveLength(1),
    );
    const [post] = callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/items`);
    expect(bodyOf(post!)).toEqual({ items: [{ menuItemId: ITEM_NAAN, quantity: 2, addons: [] }] });
    expect(headerOf(post!, 'idempotency-key')).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    // Now a PENDING line on the Hub, still editable.
    await waitFor(() =>
      expect(within(panel()).getByRole('button', { name: 'One more Butter Naan' })).toBeEnabled(),
    );
    expect(within(panel()).getByText('₹120.00')).toBeInTheDocument();
  });

  it('changes a pending line’s quantity on the Hub after the taps settle', async () => {
    order = makeOrder({ items: [makeLine({ quantity: 2 })] });
    const fetchMock = hub({
      [`PATCH /orders/${ORDER_ID}/items/${LINE_1}`]: ({ body }) => {
        order = makeOrder({
          items: [makeLine({ quantity: (body as { quantity: number }).quantity, version: 2 })],
          version: 2,
        });
        return json(order);
      },
    });
    renderApp(`/captain/orders/${ORDER_ID}`);
    const more = await within(await screen.findByRole('region', { name: 'Order #142' })).findByRole(
      'button',
      { name: 'One more Butter Naan' },
    );
    fireEvent.click(more);
    fireEvent.click(more);
    expect(
      within(panel()).getByRole('button', { name: 'Send to kitchen (4)' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', `/orders/${ORDER_ID}/items/${LINE_1}`)).toHaveLength(1),
    );
    const [patch] = callsTo(fetchMock, 'PATCH', `/orders/${ORDER_ID}/items/${LINE_1}`);
    expect(bodyOf(patch!)).toEqual({ version: 1, quantity: 4 });
  });

  it('opens the options sheet: size, add-ons within limits, quick notes, quantity and total', async () => {
    const fetchMock = hub({
      [`POST /orders/${ORDER_ID}/items`]: () => json(order),
    });
    renderApp(`/captain/orders/${ORDER_ID}`);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Chicken Biryani, from ₹190.00: choose options',
      }),
    );
    const sheet = await screen.findByRole('dialog', { name: /Chicken Biryani/ });
    expect(within(sheet).getByRole('radio', { name: /Full/ })).toBeChecked();
    fireEvent.click(within(sheet).getByRole('radio', { name: /Half/ }));

    // The group allows one add-on: picking Raita locks Extra egg.
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /Raita/ }));
    expect(within(sheet).getByRole('checkbox', { name: /Extra egg/ })).toBeDisabled();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Less spicy' }));
    expect(within(sheet).getByRole('button', { name: 'Less spicy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(within(sheet).getByPlaceholderText('Other note'), {
      target: { value: 'extra lemon' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'One more' }));
    await expectNoAxeViolations();

    // (₹190 + ₹40) × 2
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add · ₹460.00' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(panel()).getByText('Chicken Biryani (Half)')).toBeInTheDocument();
    expect(within(panel()).getByText('Less spicy, extra lemon')).toBeInTheDocument();

    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/items`)).toHaveLength(1),
    );
    expect(bodyOf(callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/items`)[0]!)).toEqual({
      items: [
        {
          menuItemId: ITEM_BIRYANI,
          variantId: VARIANT_HALF,
          quantity: 2,
          addons: [{ addonId: RAITA, quantity: 1 }],
          specialNote: 'Less spicy, extra lemon',
        },
      ],
    });
  });

  it('sends pending lines to the kitchen with an Idempotency-Key and shows the KOT', async () => {
    order = makeOrder({ items: [makeLine({ quantity: 2 })] });
    const fetchMock = hub({
      [`POST /orders/${ORDER_ID}/kots`]: () => {
        const kot = makeKotSummary();
        order = makeOrder({
          items: [makeLine({ quantity: 2, status: 'SENT', kotId: KOT_1, version: 2 })],
          kots: [kot],
          version: 3,
        });
        return json({ order, kots: [kot] }, 201);
      },
    });
    renderApp(`/captain/orders/${ORDER_ID}`);
    const send = await screen.findByRole('button', { name: 'Send to kitchen (2)' });
    fireEvent.click(send);
    expect(await screen.findByText('Sent to the kitchen: KOT 31.')).toBeInTheDocument();
    const [fire] = callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/kots`);
    expect(headerOf(fire!, 'idempotency-key')).not.toBeNull();
    const kot = within(panel()).getByRole('region', { name: 'KOT 31' });
    expect(kot).toHaveTextContent('Sent · KOT 31 · Main Kitchen');
    expect(kot).toHaveTextContent('New');
    expect(within(panel()).getByRole('button', { name: 'Send to kitchen (0)' })).toBeDisabled();
    await expectNoAxeViolations();
  });

  it('cancels a sent line with a reason, asking a manager when the role can’t', async () => {
    order = makeOrder({
      items: [makeLine({ quantity: 2, status: 'SENT', kotId: KOT_1, version: 4 })],
      kots: [makeKotSummary()],
    });
    const fetchMock = hub({
      'GET /auth/pin-users': () =>
        json({ data: [{ id: MANAGER, fullName: 'Moumita Paul', initials: 'MP' }] }),
      'POST /auth/approve': () =>
        json({
          approverToken: 'appr-1',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          approver: { id: MANAGER, fullName: 'Moumita Paul' },
        }),
      [`POST /orders/${ORDER_ID}/items/${LINE_1}/cancel`]: ({ headers, body }) => {
        if (headers.get('x-approver-token') !== 'appr-1') {
          return problem(403, 'APPROVAL_REQUIRED', { permission: 'orders.item_cancel' });
        }
        const { reason } = body as { reason: string };
        order = makeOrder({
          items: [
            makeLine({
              quantity: 2,
              status: 'CANCELLED',
              kotId: KOT_1,
              cancelReason: reason,
              version: 5,
            }),
          ],
          kots: [makeKotSummary()],
          version: 2,
        });
        return json(order);
      },
    });
    renderApp(`/captain/orders/${ORDER_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Butter Naan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel Butter Naan ×2?' });
    const confirm = within(dialog).getByRole('button', { name: 'Cancel item' });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guest changed mind' }));
    fireEvent.click(confirm);

    const approval = await screen.findByRole('dialog', { name: 'Manager approval needed' });
    expect(approval).toHaveTextContent('Cancel an item already sent');
    await expectNoAxeViolations();
    fireEvent.click(await within(approval).findByRole('button', { name: /Moumita Paul/ }));
    for (const d of '5173') fireEvent.click(within(approval).getByRole('button', { name: d }));
    fireEvent.click(within(approval).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(panel()).getByText('Cancelled: Guest changed mind')).toBeInTheDocument();
    const attempts = callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/items/${LINE_1}/cancel`);
    expect(attempts).toHaveLength(2);
    expect(bodyOf(attempts[1]!)).toEqual({
      version: 4,
      reason: 'Guest changed mind',
      isWastage: false,
    });
    expect(headerOf(attempts[1]!, 'x-approver-token')).toBe('appr-1');
    expect(headerOf(attempts[0]!, 'idempotency-key')).not.toBe(
      headerOf(attempts[1]!, 'idempotency-key'),
    );
  });

  it('marks a READY KOT served', async () => {
    order = makeOrder({
      items: [makeLine({ status: 'READY', kotId: KOT_1 })],
      kots: [makeKotSummary({ status: 'READY', version: 6 })],
    });
    const fetchMock = hub({
      [`POST /kitchen/kots/${KOT_1}/status`]: () => {
        order = makeOrder({
          items: [makeLine({ status: 'SERVED', kotId: KOT_1 })],
          kots: [makeKotSummary({ status: 'SERVED', version: 7 })],
        });
        return json(makeKot({ id: KOT_1, kotNo: 31, status: 'SERVED', version: 7 }));
      },
    });
    renderApp(`/captain/orders/${ORDER_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark KOT 31 served' }));
    await waitFor(() =>
      expect(within(panel()).getByRole('region', { name: 'KOT 31' })).toHaveTextContent('Served'),
    );
    expect(bodyOf(callsTo(fetchMock, 'POST', `/kitchen/kots/${KOT_1}/status`)[0]!)).toEqual({
      to: 'SERVED',
      version: 6,
    });
  });

  it('alerts the captain when their KOT is ready, with sound unless muted', async () => {
    hub();
    const { router } = renderApp(`/captain/orders/${ORDER_ID}`);
    await screen.findByRole('region', { name: 'Order #142' });
    const ws = FakeSocket.last;
    act(() => {
      ws.open();
      ws.receive({ type: 'hello', seq: 1, topics: ['floor'] });
    });
    const ready = (captainId: string) =>
      envelope('kitchen.kot.status_changed', {
        from: 'COOKING',
        to: 'READY',
        kot: makeKot({
          status: 'READY',
          captainId,
          items: [
            { ...makeKot().items[0]!, name: 'Chicken Biryani', quantity: 2, status: 'READY' },
          ],
        }),
      });
    act(() => ws.receive(ready('99999999-9999-4999-8999-999999999999')));
    expect(screen.queryByText('T2 · KOT 34 ready')).toBeNull();

    act(() => ws.receive(ready(USER_ID)));
    expect(await screen.findByText('T2 · KOT 34 ready')).toBeInTheDocument();
    expect(screen.getByText('Chicken Biryani ×2')).toBeInTheDocument();
    expect(chime).toHaveBeenCalledWith('ready');
    fireEvent.click(screen.getByRole('button', { name: 'Open order' }));
    expect(router.state.location.pathname).toBe(`/captain/orders/${ORDER_ID}`);
  });
});
