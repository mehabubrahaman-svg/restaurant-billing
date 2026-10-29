import { expect, test } from '@playwright/test';
import { apiAs, OWNER, signIn, STAFF, STAFF_PASSWORD } from '../support/restaurant';

interface MenuItem {
  id: string;
  sku: string;
  variants: { id: string; name: string }[];
}

test('stock: receive, a recipe, a KOT takes stock, alerts, a count, consumption and stock value', async ({
  page,
  browser,
  request,
}) => {
  // The store keeper adds rice through the screen; chicken comes in through the API.
  await signIn(page, STAFF.store.username);
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Add item' }).click();
  const add = page.getByRole('dialog', { name: 'Add item' });
  await add.getByLabel(/^SKU/).fill('RICE-BAS');
  await add.getByLabel(/^Name \(English\)/).fill('Basmati rice');
  await add.getByLabel('Name in Bengali').fill('বাসমতি চাল');
  await add.getByLabel('Category', { exact: true }).fill('Grains');
  await add.getByLabel('Bought in').selectOption('unit-kg');
  await add.getByLabel('Reorder level', { exact: true }).fill('2');
  await add.getByLabel('Unit for Reorder level').selectOption('unit-kg');
  await add.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Basmati rice saved.')).toBeVisible();
  const store = await apiAs(request, STAFF.store.username, STAFF_PASSWORD);
  await store('POST', '/inventory-items', {
    sku: 'CHK',
    name: 'Chicken',
    category: 'Meat',
    baseUnit: 'g',
    purchaseUnitId: 'unit-kg',
    isPerishable: true,
    shelfLifeDays: 2,
    reorderLevelMilli: 1_000_000,
  });

  // Bought at the market: 3 kg rice for ₹240 (₹80 a kg) and 1 kg chicken for ₹260.
  await page.goto('/inventory/stock');
  await page
    .getByRole('listitem', { name: 'Line 1' })
    .getByLabel(/^Item/)
    .selectOption({ label: 'Basmati rice' });
  const rice = page.getByRole('listitem', { name: 'Basmati rice' });
  await rice.getByLabel(/^Quantity/).fill('3');
  await rice.getByLabel(/^Cost of this line/).fill('240');
  await expect(rice.getByText('₹80.00/kg · ₹240.00')).toBeVisible();
  await page.getByRole('button', { name: 'Add line' }).click();
  await page
    .getByRole('listitem', { name: 'Line 2' })
    .getByLabel(/^Item/)
    .selectOption({ label: 'Chicken' });
  const chicken = page.getByRole('listitem', { name: 'Chicken' });
  await chicken.getByLabel(/^Quantity/).fill('1');
  await chicken.getByLabel(/^Cost of this line/).fill('260');
  await page.getByLabel(/^Bill number or note/).fill('New Market 4471');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByText('Stock received for 2 items.')).toBeVisible();
  const balances = page.getByRole('status').filter({ hasText: 'New balances' });
  await expect(balances).toContainText('3 kg');

  // The owner gives the biryani a recipe: 150 g rice and 120 g chicken a plate, every size.
  const ownerContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const owner = await ownerContext.newPage();
  await signIn(owner, OWNER.username, OWNER.password);
  const ownerApi = await apiAs(request, OWNER.username, OWNER.password);
  const menu = (await ownerApi<{ data: MenuItem[] }>('GET', '/menu-items')).data;
  const biryani = menu.find((m) => m.sku === 'BIR-CHK')!;
  await owner.goto(`/admin/menu/items/${biryani.id}`);
  const recipe = owner.getByRole('region', { name: 'Recipe' });
  await recipe
    .getByRole('listitem', { name: 'Ingredient 1' })
    .getByLabel('Ingredient', { exact: true })
    .selectOption({ label: 'Basmati rice' });
  await recipe
    .getByRole('listitem', { name: 'Basmati rice' })
    .getByLabel('Quantity', { exact: true })
    .fill('150');
  await recipe.getByRole('button', { name: 'Add ingredient' }).click();
  await recipe
    .getByRole('listitem', { name: 'Ingredient 2' })
    .getByLabel('Ingredient', { exact: true })
    .selectOption({ label: 'Chicken' });
  await recipe
    .getByRole('listitem', { name: 'Chicken' })
    .getByLabel('Quantity', { exact: true })
    .fill('120');
  // ₹12.00 of rice and ₹31.20 of chicken: ₹43.20 a plate, 13.5% of ₹320.
  await expect(recipe.getByRole('group', { name: 'Estimate' })).toContainText('₹43.20');
  await recipe.getByRole('button', { name: 'Save recipe' }).click();
  await expect(owner.getByText('Recipe for Chicken Biryani saved.')).toBeVisible();
  await expect(recipe.getByRole('group', { name: 'Costs' })).toContainText('13.5%');
  await ownerContext.close();

  // A takeaway of 10 half biryanis goes to the kitchen: the KOT takes 1.5 kg rice and 1.2 kg chicken.
  const cashier = await apiAs(request, STAFF.cashier.username, STAFF_PASSWORD);
  const half = biryani.variants.find((v) => v.name === 'Half')!;
  const order = await cashier<{ id: string }>('POST', '/orders', { orderType: 'TAKEAWAY' });
  await cashier('POST', `/orders/${order.id}/items`, {
    items: [{ menuItemId: biryani.id, variantId: half.id, quantity: 10 }],
  });
  await cashier('POST', `/orders/${order.id}/kots`);

  await page.goto('/inventory');
  const riceRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: 'Basmati rice' }) });
  await expect(riceRow).toContainText('1.5 kg');
  await expect(riceRow).toContainText('Low');
  await page.getByRole('link', { name: /^Alerts/ }).click();
  await expect(page.getByRole('region', { name: /Low and out of stock/ })).toContainText(
    'Basmati rice',
  );
  // More chicken went out than came in: a receipt is missing or the recipe is off.
  await expect(page.getByRole('region', { name: /Negative stock/ })).toContainText('-200 g');

  // The closing count: 1.4 kg of rice on the shelf (100 g short), no chicken left.
  await page.getByRole('link', { name: 'Counts' }).click();
  await page.getByRole('button', { name: 'New count' }).click();
  const start = page.getByRole('dialog', { name: 'New count' });
  await start.getByRole('radio', { name: 'Closing' }).click();
  await start.getByRole('button', { name: 'Start counting' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Closing count/ })).toBeVisible();
  await page.getByLabel('Counted Basmati rice').fill('1.4');
  await page.getByLabel('Counted Chicken').fill('0');
  await expect(page.getByRole('row').filter({ hasText: 'Basmati rice' })).toContainText('-0.1 kg');
  await page.getByRole('button', { name: 'Save counts' }).click();
  await expect(page.getByText('Counts saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Post count' }).click();
  await page
    .getByRole('dialog', { name: 'Post this count?' })
    .getByRole('button', { name: 'Post count' })
    .click();
  await expect(page.getByText('Count posted: the differences are booked.')).toBeVisible();

  // Consumption: rice used 100 g more than the recipes say on 1.5 kg sold, 6.67%: flagged.
  await page.getByRole('link', { name: 'Consumption' }).click();
  const report = page.getByRole('table', { name: 'Consumption' });
  const riceLine = report.getByRole('row').filter({ hasText: 'Basmati rice' });
  await expect(riceLine).toContainText('3 kg');
  await expect(riceLine).toContainText('1.5 kg');
  await expect(riceLine).toContainText('-100 g');
  await expect(riceLine).toContainText('1.4 kg');
  await expect(riceLine).toContainText('+6.67%');
  await expect(page.getByText(/more than 5% off the recipes/)).toBeVisible();

  // Stock value: the 1.4 kg of rice left at ₹80 a kg is ₹112; the count put chicken back to nothing.
  await page.getByRole('link', { name: 'Stock value' }).click();
  const value = page.getByRole('table', { name: 'Stock value' });
  const riceValue = value.getByRole('row').filter({ hasText: 'Basmati rice' });
  await expect(riceValue).toContainText('1.4 kg');
  await expect(riceValue).toContainText('₹80.00/kg');
  await expect(riceValue).toContainText('₹112.00');
  await expect(value.getByRole('row').filter({ hasText: 'Chicken' })).not.toContainText(
    'Below zero',
  );
  await expect(page.getByRole('table', { name: 'How the value moved' })).toContainText('₹112.00');
});
