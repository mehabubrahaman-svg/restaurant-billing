import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { OWNER, signIn, STAFF } from '../support/restaurant';

test('delivery: a Swiggy order at the counter, without liquor, billed without GST', async ({
  page,
}) => {
  await signIn(page, STAFF.cashier.username);
  await page.goto('/pos/delivery');
  await expect(page.getByRole('heading', { name: 'New delivery order' })).toBeVisible();
  await page.getByLabel(/Channel order number/).fill('SWG-7734512');

  // Beer is refused: liquor can't be sold through a delivery app.
  await page.getByRole('button', { name: 'Bar' }).click();
  await page.getByRole('button', { name: /^Add Beer 650 ml/ }).click();
  await page.getByRole('button', { name: 'Send to kitchen' }).click();
  await expect(
    page.getByText("Liquor can't be sold through a delivery app. Remove it from this order."),
  ).toBeVisible();

  // Without the beer it goes through, at Swiggy's prices (10% above the menu).
  await page.getByRole('button', { name: 'Remove Beer 650 ml' }).click();
  await page.getByRole('button', { name: 'Breads' }).click();
  await page.getByRole('button', { name: /^Add Butter Naan/ }).click();
  await page.getByRole('button', { name: /^Add Butter Naan/ }).click();
  await page.getByRole('button', { name: 'Send to kitchen' }).click();
  await expect(page.getByText(/Swiggy #SWG-7734512 sent to the kitchen as token 1/)).toBeVisible();

  // Billed with no GST (Swiggy pays it) and settled to the aggregator.
  await page.getByRole('link', { name: 'Open the bill' }).click();
  await expect(page.getByText('Swiggy #SWG-7734512').first()).toBeVisible();
  await expect(page.getByText(/CGST|SGST/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate bill' }).click();
  await expect(page.getByText(/Bill KOL1\/2026-27\/\d{6} issued/)).toBeVisible();
  await expect(
    page.getByText(/GST on this aggregator order is paid by the aggregator/),
  ).toBeVisible();
  // Settled to Swiggy (it pays the restaurant later), against its order number.
  await page.getByRole('button', { name: 'Swiggy', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /Channel order number/ })).toHaveValue(
    'SWG-7734512',
  );
  await page.getByRole('button', { name: /Record payment ₹132\.00/ }).click();
  await expect(page.getByText('Paid').first()).toBeVisible();
});

test('day-end: the owner sees the day add up, downloads the CSV and takes a backup', async ({
  page,
}) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.goto('/reports/day-end');
  await expect(page.getByRole('heading', { name: 'Day-end report' })).toBeVisible();
  // The dine-in bill (₹504) and the Swiggy bill (₹132).
  await expect(page.locator('dt', { hasText: /^Net sales$/ }).locator('+ dd')).toHaveText(
    '₹636.00',
  );

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^day-end-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('Net sales,636.00');
  expect(csv).toContain('Swiggy,1,132.00,29.04,102.96');

  await page.goto('/admin/backups');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/Backup restroos-.*-manual\.rbak saved\./)).toBeVisible();
});
