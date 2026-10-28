import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import {
  ITEMS,
  KG,
  makeAlerts,
  makeInventoryItem,
  makeMovement,
  RICE,
  rice,
  UNITS,
} from '../../test/inventory-fixtures';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

const ghee = makeInventoryItem({
  id: '1a000000-0000-4000-8000-000000000009',
  sku: 'GHEE',
  name: 'Ghee',
  nameTranslations: {},
  category: 'Dairy',
  qtyMilli: 0,
  isActive: false,
});

/** The INVENTORY role's store-room permissions. */
const STORE = [
  'inventory.view',
  'inventory.manage_items',
  'inventory.adjust',
  'inventory.count',
  'reports.inventory',
];

function hub(routes: Record<string, Handler> = {}, permissions = STORE) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /inventory-items': ({ url }) =>
      json({ data: url.searchParams.get('includeRetired') === 'true' ? [...ITEMS, ghee] : ITEMS }),
    'GET /units': () => json({ data: UNITS }),
    'GET /stock/alerts': () => json(makeAlerts()),
    ...routes,
  });
}
const bodiesOf = (fetchMock: ReturnType<typeof mockHub>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(
      ([u, init]) =>
        new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
        (init?.method ?? 'GET') === method,
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Stock items', () => {
  it('lists items by category with what is on hand, its level, average cost and value', async () => {
    hub();
    renderApp('/inventory');
    const table = await screen.findByRole('table', { name: 'Stock items' });
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['Dairy', 'Grains', 'Meat']);
    const riceRow = within(table).getByRole('link', { name: 'Basmati rice' }).closest('tr')!;
    // 30 kg at ₹86.67 a kg, above its 25 kg maximum.
    expect(riceRow).toHaveTextContent('30 kg');
    expect(riceRow).toHaveTextContent('Over max');
    expect(riceRow).toHaveTextContent('₹86.67/kg');
    expect(riceRow).toHaveTextContent('₹2,600.10');
    const eggRow = within(table).getByRole('link', { name: 'Eggs' }).closest('tr')!;
    expect(eggRow).toHaveTextContent('36 pc');
    expect(eggRow).toHaveTextContent('₹6.00/pc');
    expect(within(table).getByRole('link', { name: 'Curd' }).closest('tr')).toHaveTextContent(
      'Out',
    );
    expect(within(table).getByRole('link', { name: 'Butter' }).closest('tr')).toHaveTextContent(
      'Low',
    );
    // ₹600 butter + ₹216 eggs + ₹400 flour + ₹2,600.10 rice + ₹3,649.95 chicken
    expect(
      screen.getByText('Stock value', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('₹7,466.05');
    expect(screen.getByText('To reorder', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      '2 items',
    );
    // Out and low items and expiring lots: a count on the Alerts tab.
    expect(screen.getByRole('link', { name: /Alerts/ })).toHaveTextContent(
      'Alerts44 need attention',
    );
    await expectNoAxeViolations();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find an item' }), {
      target: { value: 'चावल' },
    });
    expect(
      within(table)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Basmati rice']);
  });

  it('adds an item with its levels in kg, and says when the SKU is taken', async () => {
    let taken = true;
    const fetchMock = hub({
      'POST /inventory-items': ({ body }) =>
        taken
          ? problem(409, 'SKU_TAKEN')
          : json(makeInventoryItem({ ...(body as object), id: RICE, qtyMilli: 0 }), 201),
    });
    renderApp('/inventory');
    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add item' });
    fireEvent.change(within(dialog).getByLabelText(/^SKU/), { target: { value: 'rice-bas' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name \(English\)/), {
      target: { value: 'Basmati rice' },
    });
    fireEvent.change(within(dialog).getByLabelText('Name in Hindi'), {
      target: { value: 'बासमती चावल' },
    });
    fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: 'Grains' } });
    fireEvent.change(within(dialog).getByLabelText('Bought in'), { target: { value: 'unit-kg' } });
    fireEvent.change(within(dialog).getByLabelText('Reorder level'), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText('Unit for Reorder level'), {
      target: { value: 'unit-kg' },
    });
    fireEvent.change(within(dialog).getByLabelText('Maximum stock'), { target: { value: '4.5' } });
    fireEvent.change(within(dialog).getByLabelText('Unit for Maximum stock'), {
      target: { value: 'unit-kg' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Maximum stock')).toHaveAccessibleDescription(
        expect.stringContaining('The maximum must be more than the reorder level.'),
      ),
    );
    expect(bodiesOf(fetchMock, 'POST', '/inventory-items')).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText('Maximum stock'), { target: { value: '25' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^SKU/)).toHaveAccessibleDescription(
        expect.stringContaining('Another item already uses this SKU'),
      ),
    );
    await expectNoAxeViolations();

    taken = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodiesOf(fetchMock, 'POST', '/inventory-items').at(-1)).toEqual({
      sku: 'RICE-BAS',
      name: 'Basmati rice',
      nameTranslations: { hi: 'बासमती चावल' },
      category: 'Grains',
      baseUnit: 'g',
      purchaseUnitId: 'unit-kg',
      isPerishable: false,
      shelfLifeDays: null,
      reorderLevelMilli: 5 * KG,
      maxLevelMilli: 25 * KG,
    });
    expect(await screen.findByText('Basmati rice saved.')).toBeInTheDocument();
  });

  it('edits an item whose stock has moved: the base unit is fixed, retiring may be refused', async () => {
    const fetchMock = hub({
      'GET /stock/movements': () => json({ data: [makeMovement()], nextCursor: null }),
      [`PATCH /inventory-items/${RICE}`]: ({ body }) =>
        (body as { isActive?: boolean }).isActive === false
          ? problem(422, 'INGREDIENT_IN_USE')
          : json(makeInventoryItem({ reorderLevelMilli: 8 * KG, version: 3 })),
    });
    renderApp('/inventory');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Basmati rice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Basmati rice' });
    // The levels come back in the unit rice is bought in.
    expect(within(dialog).getByLabelText('Reorder level')).toHaveValue('5');
    expect(within(dialog).getByLabelText('Maximum stock')).toHaveValue('25');
    expect(await within(dialog).findByText('Stock has moved, so the unit is fixed.')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Pieces' }));
    expect(within(dialog).getByRole('radio', { name: 'Weight (g)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This item is used in a recipe or an add-on.',
    );

    fireEvent.change(within(dialog).getByLabelText('Reorder level'), { target: { value: '8' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodiesOf(fetchMock, 'PATCH', `/inventory-items/${RICE}`).at(-1)).toMatchObject({
      version: 2,
      reorderLevelMilli: 8 * KG,
      maxLevelMilli: 25 * KG,
    });
  });

  it('opens an item with its movements, a page at a time', async () => {
    const fetchMock = hub({
      [`GET /inventory-items/${RICE}`]: () => json(rice),
      'GET /stock/movements': ({ url }) =>
        url.searchParams.get('before') === null
          ? json({
              data: [
                makeMovement({
                  id: '1b000000-0000-4000-8000-000000000003',
                  type: 'SALE_CONSUMPTION',
                  qtyMilli: -500_000,
                  balanceAfterMilli: 30 * KG,
                  value: -4_334,
                  createdByName: null,
                }),
                makeMovement({
                  id: '1b000000-0000-4000-8000-000000000002',
                  type: 'WASTAGE',
                  qtyMilli: -KG,
                  balanceAfterMilli: 30_500_000,
                  value: -8_667,
                  reason: 'Rats got into the sack',
                }),
              ],
              nextCursor: '1b000000-0000-4000-8000-000000000002',
            })
          : json({ data: [makeMovement({ batchNo: 'LOT-7' })], nextCursor: null }),
    });
    renderApp(`/inventory/items/${RICE}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Basmati rice' })).toBeVisible();
    expect(screen.getByText('Average cost').nextElementSibling).toHaveTextContent('₹86.67/kg');
    expect(screen.getByText('Reorder / maximum').nextElementSibling).toHaveTextContent(
      '5 kg / 25 kg',
    );
    const table = await screen.findByRole('table', { name: 'Movements' });
    expect(within(table).getByText('Used in sales').closest('tr')).toHaveTextContent('-500 g');
    expect(within(table).getByText(/Rats got into the sack/)).toBeVisible();
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await within(table).findByText(/Lot LOT-7/)).toBeVisible();
    expect(within(table).getByText('Received').closest('tr')).toHaveTextContent('+10 kg');
    const older = fetchMock.mock.calls
      .map(([u]) => new URL(String(u), 'http://hub.test'))
      .filter((u) => u.pathname === '/api/v1/stock/movements' && u.searchParams.has('before'));
    expect(older.map((u) => u.searchParams.get('before'))).toEqual([
      '1b000000-0000-4000-8000-000000000002',
    ]);
    expect(older[0]!.searchParams.get('inventoryItemId')).toBe(RICE);
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
  });

  it('names a count’s adjustment in the user’s language, not the Hub’s', async () => {
    await i18n.changeLanguage('hi-IN');
    hub({
      [`GET /inventory-items/${RICE}`]: () => json(rice),
      'GET /stock/movements': () =>
        json({
          data: [
            makeMovement({
              type: 'ADJUSTMENT',
              qtyMilli: -500_000,
              balanceAfterMilli: 30 * KG,
              value: -4_334,
              referenceType: 'STOCK_COUNT',
              reason: 'Stock count',
            }),
          ],
          nextCursor: null,
        }),
    });
    renderApp(`/inventory/items/${RICE}`);
    const table = await screen.findByRole('table', { name: 'आवक-जावक' });
    expect(within(table).getByText(/स्टॉक की गिनती/)).toBeInTheDocument();
    expect(within(table).queryByText(/Stock count/)).toBeNull();
  });

  it('shows only what the role may do', async () => {
    hub({}, ['inventory.view']);
    renderApp('/inventory');
    await screen.findByRole('table', { name: 'Stock items' });
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    const tabs = within(screen.getByRole('navigation', { name: 'Stock sections' }));
    expect(tabs.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/inventory',
      '/inventory/counts',
      '/inventory/alerts',
    ]);
  });

  it('keeps people without inventory.view out, and the stock forms for inventory.adjust', async () => {
    hub({}, ['inventory.view']);
    const { router } = renderApp('/inventory/stock');
    expect(await screen.findByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
    await act(() => router.navigate('/inventory/consumption'));
    expect(await screen.findByText(/cannot open Consumption/)).toBeInTheDocument();
  });

  it('is not in the nav for a cashier', async () => {
    hub({}, ['billing.create']);
    renderApp('/inventory');
    expect(await screen.findByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
    expect(screen.getByText(/cannot open Stock/)).toBeInTheDocument();
  });

  it('reads in Bengali', async () => {
    await i18n.changeLanguage('bn-IN');
    hub();
    renderApp('/inventory');
    const table = await screen.findByRole('table', { name: 'স্টকের মালপত্র' });
    const row = within(table).getByRole('link', { name: 'বাসমতি চাল' }).closest('tr')!;
    expect(row).toHaveTextContent('30 কেজি');
    expect(row).toHaveTextContent('সীমার বেশি');
    expect(row).toHaveTextContent('Basmati rice');
    await expectNoAxeViolations();
  });
});
