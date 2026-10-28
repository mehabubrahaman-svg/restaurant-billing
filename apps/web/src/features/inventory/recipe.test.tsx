import type { Recipe } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import {
  addonGroups,
  categories,
  ITEM_BIRYANI,
  makeItem,
  naan,
  stations,
  VARIANT_HALF,
} from '../../test/catalog-fixtures';
import {
  CHICKEN,
  CURD,
  G,
  ITEMS,
  makeDishRecipe,
  makeFullRecipe,
  RAITA,
  RECIPE_FULL,
  RICE,
  UNITS,
} from '../../test/inventory-fixtures';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';

const KEEPER = ['menu.manage', 'inventory.view', 'inventory.manage_items'];

/** The menu editor's Hub, with the biryani's two recipes (the dish's and Full's). */
function hub(routes: Record<string, Handler> = {}, permissions = KEEPER) {
  let recipes: Recipe[] = [makeDishRecipe(), makeFullRecipe()];
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /menu-items': () => json({ data: [makeItem(), naan] }),
    'GET /categories': () => json({ data: categories }),
    'GET /kitchen-stations': () => json({ data: stations }),
    'GET /addon-groups': () => json({ data: addonGroups }),
    'GET /tax-groups': () => json({ data: [] }),
    'GET /inventory-items': () => json({ data: ITEMS }),
    'GET /units': () => json({ data: UNITS }),
    'GET /recipes': () => json({ data: recipes }),
    [`PATCH /recipes/${RECIPE_FULL}`]: ({ body }) => {
      const patch = body as { version: number; isActive?: boolean };
      if (patch.isActive === false) {
        recipes = recipes.filter((r) => r.id !== RECIPE_FULL);
        return new Response(null, { status: 204 });
      }
      const saved = makeFullRecipe({
        version: patch.version + 1,
        ingredients: [
          { ...makeFullRecipe().ingredients[0]!, qtyMilli: 300 * G, costPerPortion: 2_600 },
          makeFullRecipe().ingredients[1]!,
        ],
        costPerPortion: 7_953,
        foodCostBp: 2_485,
      });
      recipes = [makeDishRecipe(), saved];
      return json(saved);
    },
    ...routes,
  });
}
const bodiesOf = (fetchMock: ReturnType<typeof mockHub>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(
      ([u, init]) =>
        new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
        init?.method === method,
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Recipe on the dish editor', () => {
  it('shows each recipe with the Hub’s cost per portion and food cost; a size without one uses the dish’s', async () => {
    hub();
    renderApp(`/admin/menu/items/${ITEM_BIRYANI}`);
    const section = await screen.findByRole('region', { name: 'Recipe' });
    expect(within(section).getByRole('radio', { name: 'Dish (all sizes)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const riceRow = await within(section).findByRole('listitem', { name: 'Basmati rice' });
    expect(within(riceRow).getByLabelText('Quantity')).toHaveValue('150');
    expect(within(riceRow).getByLabelText('Unit for Quantity')).toHaveValue('unit-g');
    expect(within(riceRow).getByLabelText('Quantity')).toHaveAccessibleDescription(
      '₹13.00 a portion',
    );
    const costs = within(section).getByRole('group', { name: 'Costs' });
    expect(costs).toHaveTextContent('Cost per portion₹42.20');
    expect(costs).toHaveTextContent('Menu price₹320.00');
    expect(costs).toHaveTextContent('Food cost13.19%');
    await expectNoAxeViolations();

    fireEvent.click(within(section).getByRole('radio', { name: 'Full' }));
    const full = within(section).getByRole('group', { name: 'Costs' });
    // 250 g rice + 200 g chicken with 10% trim: ₹75.20, 23.5% of ₹320.
    expect(full).toHaveTextContent('Cost per portion₹75.20');
    expect(full).toHaveTextContent('Food cost23.5%');
    expect(
      within(within(section).getByRole('listitem', { name: 'Chicken' })).getByLabelText(
        'Trim loss %',
      ),
    ).toHaveValue('10');

    fireEvent.click(within(section).getByRole('radio', { name: 'Half' }));
    expect(within(section).getByText('Half uses the dish’s recipe.')).toBeInTheDocument();
    const half = within(section).getByRole('group', { name: 'Costs' });
    // The dish's ₹42.20 against Half's own ₹190.
    expect(half).toHaveTextContent('Menu price₹190.00');
    expect(half).toHaveTextContent('Food cost22.21%');
    expect(
      within(section).getByRole('button', { name: 'Give Half its own recipe' }),
    ).toBeInTheDocument();
  });

  it('edits a recipe in any unit, estimates the cost, saves with the version and removes it', async () => {
    const fetchMock = hub();
    renderApp(`/admin/menu/items/${ITEM_BIRYANI}`);
    const section = await screen.findByRole('region', { name: 'Recipe' });
    fireEvent.click(await within(section).findByRole('radio', { name: 'Full' }));
    const riceRow = within(section).getByRole('listitem', { name: 'Basmati rice' });
    fireEvent.change(within(riceRow).getByLabelText('Unit for Quantity'), {
      target: { value: 'unit-kg' },
    });
    fireEvent.change(within(riceRow).getByLabelText('Quantity'), { target: { value: '0.3' } });
    // At today's average costs: 300 g rice ₹26.00 + chicken ₹53.53.
    const estimate = within(section).getByRole('group', { name: 'Estimate' });
    expect(estimate).toHaveTextContent('Cost per portion₹79.53');
    expect(estimate).toHaveTextContent('Food cost24.85%');

    fireEvent.click(within(section).getByRole('button', { name: 'Save recipe' }));
    expect(await screen.findByText('Recipe for Full saved.')).toBeInTheDocument();
    expect(bodiesOf(fetchMock, 'PATCH', `/recipes/${RECIPE_FULL}`)).toEqual([
      {
        version: 1,
        yieldPortions: 1,
        ingredients: [
          { inventoryItemId: RICE, qtyMilli: 300 * G, wastageBp: 0 },
          { inventoryItemId: CHICKEN, qtyMilli: 200 * G, wastageBp: 1_000 },
        ],
      },
    ]);
    // The Hub's figures replace the estimate.
    await waitFor(() =>
      expect(within(section).getByRole('group', { name: 'Costs' })).toHaveTextContent(
        'Cost per portion₹79.53',
      ),
    );

    fireEvent.click(within(section).getByRole('button', { name: 'Remove recipe' }));
    const confirm = screen.getByRole('dialog', { name: 'Remove the recipe for Full?' });
    expect(confirm).toHaveTextContent('Full will use the dish’s recipe again.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove recipe' }));
    expect(await within(section).findByText('Full uses the dish’s recipe.')).toBeInTheDocument();
    expect(bodiesOf(fetchMock, 'PATCH', `/recipes/${RECIPE_FULL}`).at(-1)).toEqual({
      version: 2,
      isActive: false,
    });
  });

  it('gives a size its own recipe from the dish’s, and explains RECIPE_EXISTS', async () => {
    const fetchMock = hub({ 'POST /recipes': () => problem(409, 'RECIPE_EXISTS') });
    renderApp(`/admin/menu/items/${ITEM_BIRYANI}`);
    const section = await screen.findByRole('region', { name: 'Recipe' });
    fireEvent.click(await within(section).findByRole('radio', { name: 'Half' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Give Half its own recipe' }));
    expect(within(section).getByRole('listitem', { name: 'Chicken' })).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Save recipe' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'This dish (or this size of it) already has a recipe.',
    );
    expect(bodiesOf(fetchMock, 'POST', '/recipes')).toEqual([
      {
        menuItemId: ITEM_BIRYANI,
        variantId: VARIANT_HALF,
        yieldPortions: 1,
        ingredients: [
          { inventoryItemId: RICE, qtyMilli: 150 * G, wastageBp: 0 },
          { inventoryItemId: CHICKEN, qtyMilli: 120 * G, wastageBp: 0 },
        ],
      },
    ]);
  });

  it('is read-only with inventory.view and not shown without stock permissions', async () => {
    hub({}, ['menu.manage', 'inventory.view']);
    const view = renderApp(`/admin/menu/items/${ITEM_BIRYANI}`);
    const section = await screen.findByRole('region', { name: 'Recipe' });
    expect(
      within(section).getByText(
        'What the dish takes from stock. Only store-room staff can change it.',
      ),
    ).toBeInTheDocument();
    const table = await within(section).findByRole('table', { name: 'Ingredients' });
    expect(within(table).getByText('Basmati rice').closest('tr')).toHaveTextContent(
      'Basmati rice150 g—₹13.00',
    );
    expect(within(section).queryByRole('button', { name: 'Save recipe' })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();
    useAuthStore.setState({ status: 'restoring', session: null });

    hub({}, ['menu.manage']);
    renderApp(`/admin/menu/items/${ITEM_BIRYANI}`);
    expect(await screen.findByDisplayValue('BIR-CHK')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recipe' })).toBeNull();
  });

  it('asks for the dish to be saved before its recipe', async () => {
    hub();
    renderApp('/admin/menu/items/new');
    expect(
      await screen.findByText('Save the dish first, then add its recipe.'),
    ).toBeInTheDocument();
  });
});

describe('Add-on ingredients', () => {
  it('sets what one add-on takes from stock', async () => {
    const fetchMock = hub({
      [`GET /addons/${RAITA}/ingredients`]: () =>
        json({
          addonId: RAITA,
          ingredients: [{ inventoryItemId: CURD, name: 'Curd', baseUnit: 'g', qtyMilli: 50 * G }],
        }),
      [`PUT /addons/${RAITA}/ingredients`]: ({ body }) =>
        json({
          addonId: RAITA,
          ingredients: (
            body as { ingredients: { inventoryItemId: string; qtyMilli: number }[] }
          ).ingredients.map((i) => ({ ...i, name: 'Curd', baseUnit: 'g' })),
        }),
    });
    renderApp('/admin/menu/addons');
    fireEvent.click(await screen.findByRole('button', { name: 'What Raita takes from stock' }));
    const dialog = await screen.findByRole('dialog', { name: 'What Raita takes from stock' });
    const curd = await within(dialog).findByRole('listitem', { name: 'Curd' });
    expect(within(curd).getByLabelText('Quantity per add-on')).toHaveValue('50');
    fireEvent.change(within(curd).getByLabelText('Quantity per add-on'), {
      target: { value: '60' },
    });
    await expectNoAxeViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Stock use for Raita saved.')).toBeInTheDocument();
    expect(bodiesOf(fetchMock, 'PUT', `/addons/${RAITA}/ingredients`)).toEqual([
      { ingredients: [{ inventoryItemId: CURD, qtyMilli: 60 * G }] },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers no stock button without stock permissions', async () => {
    hub({}, ['menu.manage']);
    renderApp('/admin/menu/addons');
    expect(await screen.findByText('Raita')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /takes from stock/ })).toBeNull();
  });
});
