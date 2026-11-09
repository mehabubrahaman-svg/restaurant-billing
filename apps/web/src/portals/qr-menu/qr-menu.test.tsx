import type { QrMenu, QrRequest, QrRequestStatusResponse } from '@restroos/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
const SWEETS = '0c100000-0000-4000-8000-000000000002';
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
  imageId: null,
  ...more,
});
const MENU: QrMenu = {
  branchName: 'Park Street',
  tableLabel: 'T1',
  categories: [
    { id: CAT, name: 'Mains', nameTranslations: { hi: 'मुख्य' }, sortOrder: 1 },
    { id: SWEETS, name: 'Desserts', nameTranslations: {}, sortOrder: 2 },
  ],
  items: [
    item(NAAN, 'Butter Naan', 6000, {
      nameTranslations: { hi: 'बटर नान' },
      description:
        'Soft, buttery naan from the tandoor. 1 piece · 240 kcal · Contains gluten, dairy',
    }),
    item(BIRYANI, 'Chicken Biryani', 25000, {
      foodType: 'NON_VEG',
      variants: [
        { id: HALF, name: 'Half', nameTranslations: none, price: 25000 },
        { id: FULL, name: 'Full', nameTranslations: none, price: 40000 },
      ],
      addonGroupIds: [SIDES],
    }),
    item(KULFI, 'Kulfi', 9000, { categoryId: SWEETS, isAvailable: false }),
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
  popularItemIds: [],
  ratings: [],
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
  sessionStorage.clear();
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
    // The guest's page keeps the phone's own text size (the staff scale is compact on a phone).
    expect(document.documentElement.dataset['guest']).toBe('');
    expect(screen.getByText('Park Street')).toBeInTheDocument();
    expect(screen.getByText('Not available now')).toBeInTheDocument();
    expect(
      screen.getByText('Prices are before GST; tax is added on the bill.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Kulfi' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add Butter Naan' }));
    // In the order now: the card counts it up and down instead.
    fireEvent.click(screen.getByRole('button', { name: 'One more Butter Naan' }));
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
    expect(sessionStorage.getItem(`qr-cart:${TOKEN}`)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Call a server' }));
    expect(await screen.findByText('A server has been called.')).toBeInTheDocument();
    expect(sent[1]).toMatchObject({ kind: 'WAITER' });
  });

  it('counts a chosen dish up and down right under it, and takes it off', async () => {
    mockHub({ ...BASE_ROUTES, [`GET /public/qr/${TOKEN}/menu`]: () => json(MENU) });
    renderApp(`/qr/${TOKEN}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Butter Naan' }));
    // Add gives way to − 1 + and Remove, with what the dish comes to.
    const naan = screen.getByRole('group', { name: 'Butter Naan in your order' });
    expect(screen.queryByRole('button', { name: 'Add Butter Naan' })).toBeNull();
    expect(within(naan).getByText('₹60.00')).toBeInTheDocument();
    fireEvent.click(within(naan).getByRole('button', { name: 'One more Butter Naan' }));
    expect(within(naan).getByText('₹120.00')).toBeInTheDocument();
    expect(screen.getByText('2 items · ₹120.00')).toBeInTheDocument();
    await expectNoAxeViolations();

    // One more of a dish with choices is one more of the way it was last chosen.
    fireEvent.click(screen.getByRole('button', { name: 'Add Chicken Biryani' }));
    const options = await screen.findByRole('dialog', { name: 'Chicken Biryani' });
    fireEvent.click(within(options).getByRole('radio', { name: /Full/ }));
    fireEvent.click(within(options).getByRole('button', { name: 'Add · ₹400.00' }));
    const biryani = screen.getByRole('group', { name: 'Chicken Biryani in your order' });
    fireEvent.click(within(biryani).getByRole('button', { name: 'One more Chicken Biryani' }));
    expect(within(biryani).getByText('₹800.00')).toBeInTheDocument();
    expect(screen.getByText('4 items · ₹920.00')).toBeInTheDocument();

    fireEvent.click(within(biryani).getByRole('button', { name: 'Remove Chicken Biryani' }));
    expect(screen.queryByRole('group', { name: 'Chicken Biryani in your order' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Chicken Biryani' })).toBeInTheDocument();
    fireEvent.click(within(naan).getByRole('button', { name: 'Remove Butter Naan' }));
    expect(screen.queryByText(/items ·/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Butter Naan' })).toBeInTheDocument();
  });

  it('keeps only the search bar pinned on a phone turned sideways', async () => {
    mockHub({ ...BASE_ROUTES, [`GET /public/qr/${TOKEN}/menu`]: () => json(MENU) });
    // A tall screen: the filters and the sections stay pinned under the search bar.
    const tall = (query: string) => ({
      matches: query === '(max-height: 500px)' ? false : false,
      addEventListener() {},
      removeEventListener() {},
    });
    vi.stubGlobal('matchMedia', tall);
    const { unmount } = renderApp(`/qr/${TOKEN}`);
    expect(await screen.findByText('Table T1')).toBeInTheDocument();
    expect(screen.getByTestId('menu-filters')).toHaveClass('sticky');
    unmount();

    // Turned sideways (little height): the filters scroll with the page.
    vi.stubGlobal('matchMedia', (query: string) => ({
      ...tall(query),
      matches: query === '(max-height: 500px)',
    }));
    renderApp(`/qr/${TOKEN}`);
    expect(await screen.findByText('Table T1')).toBeInTheDocument();
    expect(screen.getByTestId('menu-filters')).toHaveClass('relative');
    expect(screen.getByTestId('menu-filters')).not.toHaveClass('sticky');
  });

  it('shows names in the guest’s language', async () => {
    mockHub({ ...BASE_ROUTES, [`GET /public/qr/${TOKEN}/menu`]: () => json(MENU) });
    await i18n.changeLanguage('hi-IN');
    renderApp(`/qr/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'मुख्य' })).toBeInTheDocument();
    expect(screen.getByText('बटर नान')).toBeInTheDocument();
  });

  const dishes = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  it('finds dishes by a near spelling, and says so when nothing matches', async () => {
    mockHub({ ...BASE_ROUTES, [`GET /public/qr/${TOKEN}/menu`]: () => json(MENU) });
    renderApp(`/qr/${TOKEN}`);
    const box = await screen.findByRole('searchbox', { name: 'Search the menu' });
    fireEvent.change(box, { target: { value: 'biriyani' } });
    expect(await screen.findByText('1 dish found')).toBeInTheDocument();
    expect(dishes()).toEqual(['Chicken Biryani']);
    // Results mix sections, so each says which one it is from.
    expect(screen.getByText('Mains', { selector: 'span' })).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.change(box, { target: { value: 'pizza' } });
    expect(await screen.findByText('Nothing matches “pizza”.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'See the full menu' }));
    expect(box).toHaveValue('');
    expect(await screen.findByRole('heading', { name: 'Desserts' })).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'naan' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Clear search' }));
    expect(box).toHaveValue('');
  });

  it('narrows to a kind of food, sorts by price, and jumps to a section', async () => {
    mockHub({ ...BASE_ROUTES, [`GET /public/qr/${TOKEN}/menu`]: () => json(MENU) });
    renderApp(`/qr/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Mains' })).toBeInTheDocument();
    expect(screen.getByText('2 dishes')).toBeInTheDocument();
    expect(dishes()).toEqual(['Butter Naan', 'Chicken Biryani', 'Kulfi']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
      target: { value: 'priceHigh' },
    });
    expect(dishes()).toEqual(['Chicken Biryani', 'Butter Naan', 'Kulfi']);

    const veg = screen.getByRole('button', { name: 'Veg' });
    fireEvent.click(veg);
    expect(veg).toHaveAttribute('aria-pressed', 'true');
    expect(dishes()).toEqual(['Butter Naan', 'Kulfi']);
    fireEvent.click(screen.getByRole('button', { name: 'Non-veg' }));
    expect(dishes()).toEqual(['Chicken Biryani', 'Butter Naan', 'Kulfi']);
    await expectNoAxeViolations();

    const sections = screen.getByRole('navigation', { name: 'Menu sections' });
    fireEvent.click(within(sections).getByRole('button', { name: 'Desserts' }));
    expect(within(sections).getByRole('button', { name: 'Desserts' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Desserts' })).toHaveFocus());

    // The floating Menu button lists every section with its count.
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const list = await screen.findByRole('dialog', { name: 'Browse the menu' });
    fireEvent.click(within(list).getByRole('button', { name: /^Mains/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Mains' })).toHaveFocus());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the dish in full, and marks bestsellers', async () => {
    mockHub({
      ...BASE_ROUTES,
      [`GET /public/qr/${TOKEN}/menu`]: () => json({ ...MENU, popularItemIds: [NAAN, KULFI] }),
    });
    renderApp(`/qr/${TOKEN}`);
    const popular = (await screen.findByRole('heading', { name: 'Popular here' })).closest(
      'section',
    )!;
    // Only what can be ordered now.
    expect(
      within(popular)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['See Butter Naan']);
    expect(screen.getAllByText('Bestseller')).toHaveLength(2);
    expect(screen.getByText('Soft, buttery naan from the tandoor.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Butter Naan' }));
    const dish = await screen.findByRole('dialog', { name: 'Butter Naan' });
    const facts = within(dish).getByRole('list', { name: 'Good to know' });
    expect(
      within(facts)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1 piece', '240 kcal', 'Contains gluten, dairy']);
    await expectNoAxeViolations();
    fireEvent.click(within(dish).getByRole('button', { name: 'One more Butter Naan' }));
    fireEvent.click(within(dish).getByRole('button', { name: 'Add · ₹120.00' }));
    expect(screen.getByText('2 items · ₹120.00')).toBeInTheDocument();

    // A dish that has run out says so instead of offering Add.
    fireEvent.click(screen.getByRole('button', { name: 'Kulfi' }));
    const kulfi = await screen.findByRole('dialog', { name: 'Kulfi' });
    expect(within(kulfi).queryByRole('button', { name: /^Add/ })).toBeNull();
    expect(within(kulfi).getByText('Not available now')).toBeInTheDocument();
  });

  it('keeps the order on the phone through a reload, at the menu prices', async () => {
    mockHub({ ...BASE_ROUTES, [`GET /public/qr/${TOKEN}/menu`]: () => json(MENU) });
    renderApp(`/qr/${TOKEN}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Butter Naan' }));
    expect(screen.getByText('1 item · ₹60.00')).toBeInTheDocument();
    cleanup();

    renderApp(`/qr/${TOKEN}`);
    expect(await screen.findByText('1 item · ₹60.00')).toBeInTheDocument();
    cleanup();

    // What the menu no longer has, or has run out of, is left out.
    sessionStorage.setItem(
      `qr-cart:${TOKEN}`,
      JSON.stringify([
        { key: 'k1', itemId: NAAN, addonIds: [], quantity: 3, note: '' },
        { key: 'k2', itemId: KULFI, addonIds: [], quantity: 1, note: '' },
        { key: 'k3', itemId: '0c200000-0000-4000-8000-000000000099', addonIds: [], quantity: 1 },
        { key: 'k4', itemId: BIRYANI, variantId: 'gone', addonIds: [], quantity: 1 },
      ]),
    );
    renderApp(`/qr/${TOKEN}`);
    expect(await screen.findByText('3 items · ₹180.00')).toBeInTheDocument();
  });

  it('lets the guest find today’s order by phone and rate the captain and the dishes', async () => {
    const ORDER = '0c800000-0000-4000-8000-000000000001';
    const sent: unknown[] = [];
    const found = {
      orders: [
        {
          id: ORDER,
          orderNo: '142',
          tableLabel: 'T1',
          openedAt: '2026-10-28T12:00:00.000Z',
          captainName: 'Rahul',
          rated: false,
          dishes: [
            { menuItemId: NAAN, name: 'Butter Naan', nameTranslations: none, imageId: null },
            { menuItemId: BIRYANI, name: 'Chicken Biryani', nameTranslations: none, imageId: null },
          ],
        },
      ],
    };
    mockHub({
      ...BASE_ROUTES,
      [`GET /public/qr/${TOKEN}/menu`]: () =>
        json({ ...MENU, ratings: [{ menuItemId: NAAN, average: 4.5, count: 12 }] }),
      [`POST /public/qr/${TOKEN}/ratings/lookup`]: ({ body }) =>
        json((body as { phone: string }).phone === '+919876543210' ? found : { orders: [] }),
      [`POST /public/qr/${TOKEN}/ratings`]: ({ body }) => {
        sent.push(body);
        return json({ id: '0c900000-0000-4000-8000-000000000001' }, 201);
      },
    });
    renderApp(`/qr/${TOKEN}`);
    // The stars an admin counted show on the dish.
    expect(
      await screen.findByRole('img', { name: 'Rated 4.5 out of 5 by 12 guests' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rate your meal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rate your meal' });
    const phone = within(dialog).getByLabelText(/^Your mobile number/);
    fireEvent.change(phone, { target: { value: '9123456789' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Find my order' }));
    expect(await within(dialog).findByText(/couldn’t find an order/)).toBeInTheDocument();

    fireEvent.change(phone, { target: { value: '98765 43210' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Find my order' }));
    const captain = await within(dialog).findByRole('group', { name: 'How was Rahul’s service?' });
    expect(within(dialog).getByRole('button', { name: 'Send ratings' })).toBeDisabled();
    fireEvent.click(within(captain).getByRole('radio', { name: '5 stars' }));
    const naan = within(dialog).getByRole('group', { name: 'Butter Naan' });
    fireEvent.click(within(naan).getByRole('radio', { name: '4 stars' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'A note about Butter Naan' }), {
      target: { value: 'Soft and hot' },
    });
    await expectNoAxeViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send ratings' }));
    expect(await within(dialog).findByText('Thank you!')).toBeInTheDocument();
    // The biryani wasn't rated, so it isn't sent.
    expect(sent).toEqual([
      {
        orderId: ORDER,
        phone: '+919876543210',
        captainStars: 5,
        dishes: [{ menuItemId: NAAN, stars: 4, comment: 'Soft and hot' }],
      },
    ]);
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
