import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import {
  BUTTER,
  CURD,
  curd,
  EGGS,
  FLOUR,
  flour,
  G,
  ITEMS,
  KG,
  makeAlerts,
  makeInventoryItem,
  RICE,
  rice,
  eggs,
  UNITS,
} from '../../test/inventory-fixtures';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

const STORE = ['inventory.view', 'inventory.adjust'];
const REFERENCE = '1d000000-0000-4000-8000-000000000009';

function hub(routes: Record<string, Handler> = {}) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions: STORE })),
    'GET /inventory-items': () => json({ data: ITEMS }),
    'GET /units': () => json({ data: UNITS }),
    'GET /stock/alerts': () => json(makeAlerts()),
    ...routes,
  });
}
const callsTo = (fetchMock: ReturnType<typeof mockHub>, path: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) =>
      new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
      init?.method === 'POST',
  );
const bodyOf = (call: unknown[]) =>
  JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Stock in and out', () => {
  it('receives stock in the unit it was bought in, at a price per unit, with lot and expiry', async () => {
    const fetchMock = hub({
      'POST /stock/receipts': () =>
        json(
          {
            referenceId: REFERENCE,
            items: [
              makeInventoryItem({ qtyMilli: 32_500_000 }),
              { ...eggs, qtyMilli: 60_000, level: 'OK' },
            ],
          },
          201,
        ),
    });
    renderApp('/inventory/stock');
    const first = await screen.findByRole('listitem', { name: 'Line 1' });
    fireEvent.change(within(first).getByLabelText(/^Item/), { target: { value: RICE } });
    const riceLine = screen.getByRole('listitem', { name: 'Basmati rice' });
    // Rice is bought by the kg: that unit comes first.
    expect(within(riceLine).getByLabelText('Unit for Quantity')).toHaveValue('unit-kg');
    expect(within(riceLine).getByLabelText(/^Item/)).toHaveAccessibleDescription('On hand: 30 kg');
    fireEvent.change(within(riceLine).getByLabelText(/^Quantity/), { target: { value: '2.5' } });
    fireEvent.change(within(riceLine).getByLabelText(/^Cost of this line/), {
      target: { value: '250' },
    });
    expect(within(riceLine).getByLabelText(/^Cost of this line/)).toHaveAccessibleDescription(
      '₹100.00/kg · ₹250.00',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const second = screen.getByRole('listitem', { name: 'Line 2' });
    fireEvent.change(within(second).getByLabelText(/^Item/), { target: { value: EGGS } });
    const eggLine = screen.getByRole('listitem', { name: 'Eggs' });
    expect(within(eggLine).getByLabelText('Unit for Quantity')).toHaveValue('unit-dozen');
    fireEvent.change(within(eggLine).getByLabelText(/^Quantity/), { target: { value: '2' } });
    fireEvent.change(within(eggLine).getByLabelText(/^Cost of this line/), {
      target: { value: '144' },
    });
    expect(within(eggLine).getByLabelText(/^Cost of this line/)).toHaveAccessibleDescription(
      '₹72.00/dozen · ₹144.00',
    );
    fireEvent.change(within(eggLine).getByLabelText(/^Lot number/), { target: { value: 'LOT-9' } });
    fireEvent.change(within(eggLine).getByLabelText(/^Expiry date/), {
      target: { value: '2026-11-05' },
    });
    fireEvent.change(screen.getByLabelText(/^Bill number or note/), {
      target: { value: 'Bill 4471' },
    });
    expect(screen.getByText('Total ₹394.00')).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    const balances = await screen.findByRole('heading', { name: 'New balances' });
    expect(balances.parentElement).toHaveTextContent('32.5 kg');
    expect(balances.parentElement).toHaveTextContent('60 pc');
    const [call] = callsTo(fetchMock, '/stock/receipts');
    // 2.5 kg = 2_500_000 milli-g; 2 dozen = 24 eggs = 24_000 milli-pc; ₹ in paise.
    expect(bodyOf(call!)).toEqual({
      reference: 'Bill 4471',
      lines: [
        {
          inventoryItemId: RICE,
          qtyMilli: 2_500_000,
          totalCost: 25_000,
          batchNo: null,
          expiresOn: null,
        },
        {
          inventoryItemId: EGGS,
          qtyMilli: 24_000,
          totalCost: 14_400,
          batchNo: 'LOT-9',
          expiresOn: '2026-11-05',
        },
      ],
    });
    expect(new Headers((call![1] as RequestInit).headers).get('idempotency-key')).toMatch(
      /^[A-Za-z0-9_-]{8,}$/,
    );
    expect(await screen.findByText('Stock received for 2 items.')).toBeInTheDocument();
  });

  it('stops on a missing item or an unreadable quantity without calling the Hub', async () => {
    const fetchMock = hub();
    renderApp('/inventory/stock');
    const first = await screen.findByRole('listitem', { name: 'Line 1' });
    fireEvent.change(within(first).getByLabelText(/^Quantity/), { target: { value: '1.2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    expect(within(first).getByLabelText(/^Item/)).toHaveAccessibleDescription('Choose an item.');
    expect(within(first).getByLabelText(/^Quantity/)).toHaveAttribute('aria-invalid', 'true');
    expect(within(first).getByLabelText(/^Cost of this line/)).toHaveAccessibleDescription(
      'Enter an amount such as 50 or 49.50.',
    );
    expect(callsTo(fetchMock, '/stock/receipts')).toEqual([]);
  });

  it('records wastage with a reason, and signed adjustments', async () => {
    const fetchMock = hub({
      'POST /stock/wastage': () =>
        json({ referenceId: REFERENCE, items: [makeInventoryItem({ id: BUTTER })] }, 201),
      'POST /stock/adjustments': () =>
        json({ referenceId: REFERENCE, items: [makeInventoryItem({ id: FLOUR })] }, 201),
    });
    renderApp('/inventory/stock?kind=wastage');
    expect(await screen.findByRole('radio', { name: 'Wastage' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const first = await screen.findByRole('listitem', { name: 'Line 1' });
    fireEvent.change(within(first).getByLabelText(/^Item/), { target: { value: BUTTER } });
    const butterLine = screen.getByRole('listitem', { name: 'Butter' });
    // Butter is bought by the gram: no purchase unit.
    expect(within(butterLine).getByLabelText('Unit for Quantity')).toHaveValue('unit-g');
    fireEvent.change(within(butterLine).getByLabelText(/^Quantity/), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record wastage' }));
    expect(screen.getByLabelText(/^Reason/)).toHaveAccessibleDescription(
      expect.stringContaining('Say what happened (3 to 200 characters).'),
    );
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Left out overnight' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record wastage' }));
    await waitFor(() => expect(callsTo(fetchMock, '/stock/wastage')).toHaveLength(1));
    expect(bodyOf(callsTo(fetchMock, '/stock/wastage')[0]!)).toEqual({
      reason: 'Left out overnight',
      lines: [{ inventoryItemId: BUTTER, qtyMilli: 200 * G }],
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Adjustment' }));
    const adjust = await screen.findByRole('listitem', { name: 'Line 1' });
    fireEvent.change(within(adjust).getByLabelText(/^Item/), { target: { value: FLOUR } });
    const flourLine = screen.getByRole('listitem', { name: 'Flour' });
    fireEvent.change(within(flourLine).getByLabelText(/^Quantity/), { target: { value: '0.5' } });
    expect(within(flourLine).getByLabelText('Change')).toHaveValue('out');
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const second = screen.getByRole('listitem', { name: 'Line 2' });
    fireEvent.change(within(second).getByLabelText(/^Item/), { target: { value: CURD } });
    const curdLine = screen.getByRole('listitem', { name: 'Curd' });
    fireEvent.change(within(curdLine).getByLabelText(/^Quantity/), { target: { value: '1' } });
    fireEvent.change(within(curdLine).getByLabelText('Unit for Quantity'), {
      target: { value: 'unit-kg' },
    });
    fireEvent.change(within(curdLine).getByLabelText('Change'), { target: { value: 'in' } });
    fireEvent.change(screen.getByLabelText(/^Reason/), {
      target: { value: 'Found a tub in the cold room' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() => expect(callsTo(fetchMock, '/stock/adjustments')).toHaveLength(1));
    expect(bodyOf(callsTo(fetchMock, '/stock/adjustments')[0]!)).toEqual({
      reason: 'Found a tub in the cold room',
      lines: [
        { inventoryItemId: FLOUR, qtyMilli: -500 * G },
        { inventoryItemId: CURD, qtyMilli: KG },
      ],
    });
  });

  it('takes opening stock until an item is first received, and explains STOCK_ALREADY_MOVED', async () => {
    hub({
      // Curd sold before its opening stock was entered; flour was received and is used up.
      'GET /inventory-items': () =>
        json({
          data: [
            rice,
            makeInventoryItem({ ...curd, qtyMilli: -50 * G, value: 0, level: 'OUT' }),
            makeInventoryItem({ ...flour, qtyMilli: 0, value: 0, level: 'OUT' }),
          ],
        }),
      'POST /stock/opening': () => problem(409, 'STOCK_ALREADY_MOVED'),
    });
    renderApp('/inventory/stock?kind=opening');
    const first = await screen.findByRole('listitem', { name: 'Line 1' });
    const select = within(first).getByLabelText(/^Item/);
    // Received stock has an average cost: those items can't take opening stock any more.
    expect(
      within(select).getByRole('option', { name: 'Basmati rice (already received)' }),
    ).toBeDisabled();
    expect(within(select).getByRole('option', { name: 'Flour (already received)' })).toBeDisabled();
    expect(within(select).getByRole('option', { name: 'Curd' })).toBeEnabled();
    fireEvent.change(select, { target: { value: CURD } });
    const curdLine = screen.getByRole('listitem', { name: 'Curd' });
    expect(within(curdLine).getByLabelText(/^Item/)).toHaveAccessibleDescription('On hand: -50 g');
    fireEvent.change(within(curdLine).getByLabelText(/^Quantity/), { target: { value: '1500' } });
    fireEvent.change(within(curdLine).getByLabelText(/^Cost of this line/), {
      target: { value: '180' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save opening stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An item here has already been received',
    );
  });

  it('starts with the item an alert linked to', async () => {
    hub();
    renderApp(`/inventory/stock?kind=receive&item=${RICE}`);
    const riceLine = await screen.findByRole('listitem', { name: rice.name });
    expect(within(riceLine).getByLabelText(/^Item/)).toHaveValue(RICE);
  });

  it('asks before another kind clears the lines typed so far', async () => {
    hub();
    renderApp(`/inventory/stock?item=${RICE}`);
    const riceLine = await screen.findByRole('listitem', { name: rice.name });
    fireEvent.change(within(riceLine).getByLabelText(/^Quantity/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Wastage' }));
    const ask = await screen.findByRole('dialog', { name: 'Clear this form?' });
    expect(ask).toHaveTextContent('Switching to Wastage clears it.');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('radio', { name: 'Received' })).toHaveAttribute('aria-checked', 'true');
    expect(within(riceLine).getByLabelText(/^Quantity/)).toHaveValue('2');

    fireEvent.click(screen.getByRole('radio', { name: 'Wastage' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Clear this form?' })).getByRole('button', {
        name: 'Clear and switch',
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Wastage' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    const fresh = await screen.findByRole('listitem', { name: 'Line 1' });
    expect(within(fresh).getByLabelText(/^Item/)).toHaveValue('');
    expect(within(fresh).getByLabelText(/^Quantity/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Record wastage' })).toBeInTheDocument();
  });
});
