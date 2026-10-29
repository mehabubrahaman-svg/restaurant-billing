import type { QrMenu, QrRequest, QrRequestStatusResponse } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import { makeFloor } from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub, problem } from '../../test/mock-hub';
import { makeOrder } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

const TOKEN = 'tok_12345678';
const CAT = '0c100000-0000-4000-8000-000000000001';
const NAAN = '0c200000-0000-4000-8000-000000000001';
const BIRYANI = '0c200000-0000-4000-8000-000000000002';
const KULFI = '0c200000-0000-4000-8000-000000000003';
const HALF = '0c300000-0000-4000-8000-000000000001';
const FULL = '0c300000-0000-4000-8000-000000000002';
const SIDES = '0c400000-0000-4000-8000-000000000001';
const RAITA = '0c500000-0000-4000-8000-000000000001';
const REQUEST = '0c600000-0000-4000-8000-000000000001';
const TABLE = '0c700000-0000-4000-8000-000000000001';

const none = {};
const item = (
  id: string,
  name: string,
  price: number,
  more: Partial<QrMenu['items'][number]> = {},
) => ({
  id,
  categoryId: CAT,
  name,
  nameTranslations: none,
  description: null,
  descriptionTranslations: none,
  foodType: 'VEG' as const,
  price,
  taxIncluded: false,
  variants: [],
  addonGroupIds: [],
  isAvailable: true,
  ...more,
});
const MENU: QrMenu = {
  branchName: 'Park Street',
  tableLabel: 'T1',
  categories: [{ id: CAT, name: 'Mains', nameTranslations: { hi: 'मुख्य' }, sortOrder: 1 }],
  items: [
    item(NAAN, 'Butter Naan', 6000, { nameTranslations: { hi: 'बटर नान' } }),
    item(BIRYANI, 'Chicken Biryani', 25000, {
      foodType: 'NON_VEG',
      variants: [
        { id: HALF, name: 'Half', nameTranslations: none, price: 25000 },
        { id: FULL, name: 'Full', nameTranslations: none, price: 40000 },
      ],
      addonGroupIds: [SIDES],
    }),
    item(KULFI, 'Kulfi', 9000, { isAvailable: false }),
  ],
  addonGroups: [
    {
      id: SIDES,
      name: 'Sides',
      nameTranslations: none,
      minSelect: 0,
      maxSelect: 1,
      addons: [{ id: RAITA, name: 'Raita', nameTranslations: none, price: 3000 }],
    },
  ],
};
const sentOrder = (status: QrRequestStatusResponse['status']): QrRequestStatusResponse => ({
  id: REQUEST,
  kind: 'ORDER',
  status,
  items: [],
  rejectReason: null,
  createdAt: '2026-10-28T12:00:00.000Z',
});

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('QR menu (the guest’s phone)', () => {
  it('builds an order with sizes and add-ons, sends it, and shows when a server confirms it', async () => {
    const sent: unknown[] = [];
    mockHub({
      ...BASE_ROUTES,
      [`GET /public/qr/${TOKEN}/menu`]: () => json(MENU),
      [`POST /public/qr/${TOKEN}/requests`]: ({ body }) => {
        sent.push(body);
        const kind = (body as { kind: QrRequestStatusResponse['kind'] }).kind;
        return json(
          kind === 'ORDER'
            ? sentOrder('PENDING')
            : { ...sentOrder('PENDING'), id: '0c600000-0000-4000-8000-000000000002', kind },
          201,
        );
      },
      [`GET /public/qr/${TOKEN}/requests/${REQUEST}`]: () => json(sentOrder('ACCEPTED')),
      [`GET /public/qr/${TOKEN}/requests/0c600000-0000-4000-8000-000000000002`]: () =>
        json({
          ...sentOrder('PENDING'),
          id: '0c600000-0000-4000-8000-000000000002',
          kind: 'WAITER',
        }),
    });
    renderApp(`/qr/${TOKEN}`);
    expect(await screen.findByText('Table T1')).toBeInTheDocument();
    expect(screen.getByText('Park Street')).toBeInTheDocument();
    expect(screen.getByText('Not available now')).toBeInTheDocument();
    expect(
      screen.getByText('Prices are before GST; tax is added on the bill.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Kulfi' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add Butter Naan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Butter Naan' }));
    expect(screen.getByText('2 items · ₹120.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Chicken Biryani' }));
    const options = await screen.findByRole('dialog', { name: 'Chicken Biryani' });
    fireEvent.click(within(options).getByRole('radio', { name: /Full/ }));
    fireEvent.click(within(options).getByRole('checkbox', { name: /Raita/ }));
    await expectNoAxeViolations();
    fireEvent.click(within(options).getByRole('button', { name: 'Add · ₹430.00' }));
    expect(screen.getByText('3 items · ₹550.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View order' }));
    const cart = await screen.findByRole('dialog', { name: 'Your order' });
    fireEvent.change(within(cart).getByLabelText('How many of you? (optional)'), {
      target: { value: '3' },
    });
    fireEvent.click(within(cart).getByRole('button', { name: 'Send order · ₹550.00' }));
    expect(
      await screen.findByText('Your order is confirmed and on its way to the kitchen.'),
    ).toBeInTheDocument();
    expect(sent[0]).toEqual({
      kind: 'ORDER',
      clientKey: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
      items: [
        { menuItemId: NAAN, quantity: 2, addons: [] },
        {
          menuItemId: BIRYANI,
          variantId: FULL,
          quantity: 1,
          addons: [{ addonId: RAITA, quantity: 1 }],
        },
      ],
      covers: 3,
    });
    expect(screen.queryByText(/items ·/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Call a server' }));
    expect(await screen.findByText('A server has been called.')).toBeInTheDocument();
    expect(sent[1]).toMatchObject({ kind: 'WAITER' });
  });

  it('shows names in the guest’s language', async () => {
    mockHub({ ...BASE_ROUTES, [`GET /public/qr/${TOKEN}/menu`]: () => json(MENU) });
    await i18n.changeLanguage('hi-IN');
    renderApp(`/qr/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'मुख्य' })).toBeInTheDocument();
    expect(screen.getByText('बटर नान')).toBeInTheDocument();
  });

  it('says so when the code is not in use', async () => {
    mockHub({
      ...BASE_ROUTES,
      [`GET /public/qr/${TOKEN}/menu`]: () => problem(404, 'NOT_FOUND'),
    });
    renderApp(`/qr/${TOKEN}`);
    expect(
      await screen.findByText('This QR code isn’t in use. Please ask a server.'),
    ).toBeInTheDocument();
  });
});

describe('Guest requests on the captain’s floor', () => {
  const order: QrRequest = {
    ...sentOrder('PENDING'),
    items: [
      {
        menuItemId: BIRYANI,
        variantId: FULL,
        quantity: 1,
        addons: [{ addonId: RAITA, quantity: 1 }],
        note: 'less spicy',
        name: 'Chicken Biryani',
        variantName: 'Full',
        addonNames: ['Raita'],
      },
    ],
    tableId: TABLE,
    tableLabel: 'T1',
    guestName: 'Ananya',
    covers: 3,
    note: null,
    version: 1,
  };
  const call: QrRequest = {
    ...order,
    id: '0c600000-0000-4000-8000-000000000002',
    kind: 'BILL',
    items: [],
    tableLabel: 'T4',
    guestName: null,
    covers: null,
  };

  it('accepts an order onto the table, declines with a reason, and marks a call done', async () => {
    const answered: { path: string; body: unknown }[] = [];
    let pending = [order, call];
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () =>
        json(makeSession({ permissions: ['tables.view', 'orders.create'] })),
      'GET /floor': () => json(makeFloor()),
      'GET /orders': () => json({ data: [] }),
      'GET /qr-requests': () => json({ data: pending }),
      [`POST /qr-requests/${order.id}/accept`]: ({ body }) => {
        answered.push({ path: 'accept', body });
        pending = pending.filter((p) => p.id !== order.id);
        return json({ order: makeOrder(), kots: [] });
      },
      [`POST /qr-requests/${call.id}/done`]: () => {
        answered.push({ path: 'done', body: null });
        pending = [];
        return json({ ...call, status: 'DONE' });
      },
    });
    renderApp('/captain');
    const panel = (await screen.findByRole('heading', { name: '2 guest requests' })).closest(
      'section',
    )!;
    expect(within(panel).getByText('Table T1: order')).toBeInTheDocument();
    expect(
      within(panel).getByText('1 × Chicken Biryani (Full) · + Raita · less spicy'),
    ).toBeInTheDocument();
    expect(within(panel).getByText('3 guests · Ananya')).toBeInTheDocument();
    expect(within(panel).getByText('Table T4: asks for the bill')).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.click(within(panel).getByRole('button', { name: 'Accept and send' }));
    expect(
      await screen.findByText('Added to table T1 and sent to the kitchen.'),
    ).toBeInTheDocument();
    expect(answered[0]).toEqual({ path: 'accept', body: { fire: true } });

    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /guest request/ })).toBeNull(),
    );
    expect(answered[1]).toEqual({ path: 'done', body: null });
  });

  it('asks why before declining', async () => {
    const declined: unknown[] = [];
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () =>
        json(makeSession({ permissions: ['tables.view', 'orders.create'] })),
      'GET /floor': () => json(makeFloor()),
      'GET /orders': () => json({ data: [] }),
      'GET /qr-requests': () => json({ data: [order] }),
      [`POST /qr-requests/${order.id}/reject`]: ({ body }) => {
        declined.push(body);
        return json({ ...order, status: 'REJECTED' });
      },
    });
    renderApp('/captain');
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline table T1’s order' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(await within(dialog).findByText('Say why, in a few words.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Why/), {
      target: { value: 'Biryani is over' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Declined the order from table T1.')).toBeInTheDocument();
    expect(declined).toEqual([{ reason: 'Biryani is over' }]);
  });

  it('is not shown to staff who don’t take orders', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['tables.view'] })),
      'GET /floor': () => json(makeFloor()),
      'GET /orders': () => json({ data: [] }),
      'GET /qr-requests': () => json({ data: [order] }),
    });
    renderApp('/captain');
    expect(await screen.findByRole('heading', { level: 1, name: 'Captain' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /guest request/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/qr-requests'))).toBe(false);
  });
});
