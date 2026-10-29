import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import { ITEM_BIRYANI, ITEM_NAAN, makeSnapshot, VARIANT_FULL } from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { makeKotSummary, makeOrder, ORDER_ID } from '../../test/order-fixtures';
import { CHANNEL_SWIGGY, directChannel, makeChannel } from '../../test/report-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

const ZOMATO = '0e200000-0000-4000-8000-000000000003';
const CASHIER = ['billing.create', 'orders.create'];

function hub(routes: Record<string, Handler> = {}, permissions = CASHIER) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /menu': () => json(makeSnapshot()),
    'GET /orders': () => json({ data: [] }),
    'GET /sales-channels': () =>
      json({
        data: [
          directChannel,
          makeChannel(),
          makeChannel({
            id: ZOMATO,
            code: 'ZOMATO',
            name: 'Zomato',
            priceMarkupBp: 0,
            gstPaidByOperator: false,
          }),
          makeChannel({
            id: '0e200000-0000-4000-8000-000000000004',
            name: 'Old app',
            isActive: false,
          }),
        ],
      }),
    ...routes,
  });
}
const callsTo = (fetchMock: ReturnType<typeof mockHub>, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) =>
      new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
      (init?.method ?? 'GET') === method,
  );
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as unknown;

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Delivery entry', () => {
  it('keys in a Swiggy order with its OTP and dishes, and sends it to the kitchen', async () => {
    const placed = makeOrder({
      orderType: 'DELIVERY',
      tableId: null,
      tableLabel: null,
      tokenNo: 7,
      orderNo: '151',
      salesChannelId: CHANNEL_SWIGGY,
      salesChannelName: 'Swiggy',
      externalOrderId: 'SW-1001',
    });
    let duplicate = false;
    const fetchMock = hub({
      'POST /orders/aggregator': () => {
        if (duplicate) return problem(409, 'DUPLICATE_EXTERNAL_ORDER');
        duplicate = true;
        return json({ order: placed, kots: [makeKotSummary()] }, 201);
      },
    });
    renderApp('/pos/delivery');
    expect(await screen.findByRole('link', { name: 'Delivery' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const channel = await screen.findByRole('combobox', { name: /^Channel/ });
    // Direct and switched-off channels are not offered.
    await waitFor(() =>
      expect(
        within(channel)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Swiggy', 'Zomato']),
    );
    expect(screen.getByText(/Swiggy prices are 10% above the menu/)).toBeInTheDocument();
    fireEvent.change(channel, { target: { value: ZOMATO } });
    expect(screen.getByText('Charged at menu prices.')).toBeInTheDocument();
    fireEvent.change(channel, { target: { value: CHANNEL_SWIGGY } });

    const send = screen.getByRole('button', { name: 'Send to kitchen' });
    expect(send).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: 'Breads' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Butter Naan, ₹60.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Butter Naan, ₹60.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Biryani' }));
    fireEvent.click(screen.getByRole('button', { name: /Chicken Biryani, from ₹190.00/ }));
    const sheet = await screen.findByRole('dialog', { name: /Chicken Biryani/ });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add · ₹320.00' }));
    expect(screen.getByRole('heading', { name: '3 items' })).toBeInTheDocument();
    expect(screen.getByText('₹440.00')).toBeInTheDocument();

    fireEvent.click(send);
    expect(screen.getByText(/Enter the order number from the partner app/)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/orders/aggregator')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Channel order number/), {
      target: { value: 'SW-1001' },
    });
    fireEvent.change(screen.getByLabelText(/Rider OTP/), { target: { value: '4821' } });
    await expectNoAxeViolations();
    fireEvent.click(send);

    expect(
      await screen.findByText('Swiggy #SW-1001 sent to the kitchen as token 7 (1 KOT).'),
    ).toBeInTheDocument();
    const call = callsTo(fetchMock, 'POST', '/orders/aggregator')[0]!;
    expect(bodyOf(call)).toEqual({
      salesChannelId: CHANNEL_SWIGGY,
      externalOrderId: 'SW-1001',
      externalOtp: '4821',
      items: [
        { menuItemId: ITEM_NAAN, quantity: 2, addons: [] },
        { menuItemId: ITEM_BIRYANI, variantId: VARIANT_FULL, quantity: 1, addons: [] },
      ],
    });
    expect(new Headers((call[1] as RequestInit).headers).get('idempotency-key')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open the bill' })).toHaveAttribute(
      'href',
      `/pos?order=${ORDER_ID}`,
    );
    // The pad is cleared for the next rider.
    expect(screen.getByLabelText(/Channel order number/)).toHaveValue('');
    expect(screen.getByText('Tap dishes on the menu to add them.')).toBeInTheDocument();

    // The same Swiggy number again is refused, next to the field.
    fireEvent.change(screen.getByLabelText(/Channel order number/), {
      target: { value: 'SW-1001' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Chicken Biryani, from ₹190.00/ }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: /Chicken Biryani/ })).getByRole('button', {
        name: /^Add/,
      }),
    );
    fireEvent.click(send);
    expect(
      await screen.findByText('This aggregator order number was already entered.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Channel order number/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('says why the Hub refused liquor on a delivery order, and keeps the pad', async () => {
    hub({ 'POST /orders/aggregator': () => problem(422, 'LIQUOR_NOT_FOR_DELIVERY') });
    renderApp('/pos/delivery');
    fireEvent.click(await screen.findByRole('button', { name: 'Breads' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Butter Naan, ₹60.00' }));
    fireEvent.change(screen.getByLabelText(/Channel order number/), {
      target: { value: 'SW-2002' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to kitchen' }));
    expect(
      await screen.findByText(
        "Liquor can't be sold through a delivery app. Remove it from this order.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Channel order number/)).toHaveValue('SW-2002');
  });

  it('points to the sales channels page when no aggregator is set up', async () => {
    hub({ 'GET /sales-channels': () => json({ data: [directChannel] }) }, [
      ...CASHIER,
      'settings.manage',
    ]);
    renderApp('/pos/delivery');
    expect(await screen.findByText('No delivery channel yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up sales channels' })).toHaveAttribute(
      'href',
      '/admin/sales-channels',
    );
    expect(screen.getByRole('button', { name: 'Send to kitchen' })).toBeDisabled();
  });

  it('has no Delivery tab without orders.create', async () => {
    hub({}, ['billing.create']);
    renderApp('/pos/bills');
    await screen.findByRole('link', { name: 'Bills' });
    expect(screen.queryByRole('link', { name: 'Delivery' })).toBeNull();
  });
});

describe('Sales channels admin', () => {
  it('adds Swiggy with its commission and markup, and switches a channel off', async () => {
    let saved = makeChannel();
    const fetchMock = hub(
      {
        'GET /sales-channels': () => json({ data: [directChannel, saved] }),
        'POST /sales-channels': () => json(saved, 201),
        [`PATCH /sales-channels/${CHANNEL_SWIGGY}`]: ({ body }) => {
          saved = { ...saved, ...(body as object), version: 2 };
          return json(saved);
        },
      },
      ['settings.manage'],
    );
    renderApp('/admin/sales-channels');
    const table = await screen.findByRole('table');
    // Direct is built in: nothing to edit.
    expect(within(table).getAllByRole('button', { name: /^Edit/ })).toHaveLength(1);
    expect(within(table).getByText('Paid by the channel')).toBeInTheDocument();
    expect(within(table).getByText('22%')).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add channel' });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Swiggy' } });
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: 'sw' } });
    fireEvent.change(within(dialog).getByLabelText('Commission (%)'), { target: { value: '220' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText(/Enter a percentage from 0 to 100/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: 'swiggy' } });
    fireEvent.change(within(dialog).getByLabelText('Commission (%)'), { target: { value: '22' } });
    fireEvent.change(within(dialog).getByLabelText('Price markup (%)'), {
      target: { value: '१०' },
    });
    // The operator pays the GST, so its GSTIN goes in GSTR-1 table 14.
    const gstin = within(dialog).getByLabelText('Operator’s GSTIN');
    fireEvent.change(gstin, { target: { value: '29AAFCB7707D1Z' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('That isn’t a 15-character GSTIN.')).toBeInTheDocument();
    fireEvent.change(gstin, { target: { value: '29aafcb7707d1zq' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved Swiggy.');
    expect(bodyOf(callsTo(fetchMock, 'POST', '/sales-channels')[0]!)).toEqual({
      code: 'SWIGGY',
      name: 'Swiggy',
      kind: 'AGGREGATOR',
      commissionBp: 2200,
      priceMarkupBp: 1000,
      gstPaidByOperator: true,
      operatorGstin: '29AAFCB7707D1ZQ',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Swiggy' }));
    const edit = await screen.findByRole('dialog', { name: 'Edit Swiggy' });
    expect(within(edit).getByLabelText('Commission (%)')).toHaveValue('22');
    fireEvent.click(within(edit).getByRole('switch', { name: 'Active' }));
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', `/sales-channels/${CHANNEL_SWIGGY}`)).toHaveLength(1),
    );
    expect(
      bodyOf(callsTo(fetchMock, 'PATCH', `/sales-channels/${CHANNEL_SWIGGY}`)[0]!),
    ).toMatchObject({
      isActive: false,
      version: 1,
    });
  });
});
