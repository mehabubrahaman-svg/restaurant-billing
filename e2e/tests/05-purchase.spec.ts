import { expect, test } from '@playwright/test';
import { apiAs, OWNER, signIn } from '../support/restaurant';

test('purchase: a vendor, a PO approved and partly received into stock, paid, and the dues', async ({
  page,
  request,
}) => {
  // The stock item comes from the API (the stock screens have their own tests).
  const api = await apiAs(request, OWNER.username, OWNER.password);
  const rice = await api<{ id: string }>('POST', '/inventory-items', {
    sku: 'E2E-GOBINDO',
    name: 'Gobindobhog rice',
    baseUnit: 'g',
    purchaseUnitId: 'unit-kg',
  });
  const stock = async () =>
    (await api<{ qtyMilli: number }>('GET', `/inventory-items/${rice.id}`)).qtyMilli;
  const before = await stock();

  await signIn(page, OWNER.username, OWNER.password);
  await page.goto('/purchase');
  await expect(page).toHaveURL(/\/purchase\/vendors$/);
  await page.getByRole('button', { name: 'Add vendor' }).click();
  const vendor = page.getByRole('dialog', { name: 'Add vendor' });
  await vendor.getByLabel(/^Code/).fill('koley');
  await vendor.getByLabel(/^Name/).fill('Koley Market Traders');
  await vendor.getByLabel('GSTIN').fill('19AAKCK1234A1ZX');
  await expect(vendor.getByText(/claimed as CGST \+ SGST/)).toBeVisible();
  await vendor.getByLabel(/^Payment terms/).fill('15');
  await vendor.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved Koley Market Traders.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Koley Market Traders' })).toBeVisible();

  // A purchase order for 25 kg at ₹90/kg + 5% GST, approved and sent.
  await page.getByRole('link', { name: 'Purchase orders' }).click();
  await page.getByRole('link', { name: 'New purchase order' }).click();
  await page.getByLabel(/^Vendor/).selectOption({ label: 'Koley Market Traders' });
  const line = page.getByRole('listitem', { name: 'Line 1' });
  await line.getByLabel(/^Item/).selectOption({ label: 'Gobindobhog rice' });
  await expect(line.getByLabel(/^Unit/)).toHaveValue('unit-kg');
  await line.getByLabel(/^Quantity/).fill('25');
  await line.getByLabel(/^Price per kg/).fill('90');
  await line.getByLabel('GST').selectOption('500');
  await expect(line.getByText('₹2,250.00 + GST ₹112.50 = ₹2,362.50')).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toContainText(/KOL1\/PO\/\d{4}-\d{2}\/\d{6}.*Draft/);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(title).toContainText('Approved');
  await page.getByRole('button', { name: 'Mark as sent' }).click();
  await expect(title).toContainText('Sent');

  // 20 kg arrive and half a kilo is damp: receive against the order, then post.
  await page.getByRole('link', { name: 'Receive goods' }).click();
  const received = page.getByRole('listitem', { name: 'Line 1: Gobindobhog rice' });
  await expect(received.getByLabel(/^Delivered/)).toHaveValue('25');
  await received.getByLabel(/^Delivered/).fill('20');
  await received.getByLabel(/^Rejected/).fill('0.5');
  await received.getByLabel('Batch number').fill('KMT-1028');
  await page.getByLabel('Vendor’s bill number').fill('KMT/771');
  // Billed on what was accepted: 19.5 kg × ₹90 + 5% GST.
  await expect(received.getByText('₹1,755.00 + GST ₹87.75 = ₹1,842.75')).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(title).toContainText(/KOL1\/GRN\/\d{4}-\d{2}\/\d{6}.*Draft/);
  expect(await stock()).toBe(before);
  await page.getByRole('button', { name: 'Post GRN' }).click();
  const confirm = page.getByRole('dialog', { name: /^Post KOL1\/GRN/ });
  await expect(confirm.getByText('Gobindobhog rice: 19.5 kg')).toBeVisible();
  await confirm.getByRole('button', { name: 'Post GRN' }).click();
  await expect(page.getByText(/posted: the goods are in stock/)).toBeVisible();
  await expect(title).toContainText('Posted');
  await expect(page.getByText(/^CGST \+ SGST: a vendor in this state/)).toBeVisible();
  // Into stock in grams: 19.5 kg = 19,500,000 milli-grams.
  expect(await stock()).toBe(before + 19_500_000);

  // Pay ₹1,000 by bank against the bill.
  await page.getByRole('button', { name: 'Record payment' }).click();
  const pay = page.getByRole('dialog', { name: 'Record payment' });
  await expect(pay.getByLabel(/^Amount/)).toHaveValue('1842.75');
  await pay.getByLabel(/^Amount/).fill('1000');
  await pay.getByLabel('UTR / transaction ID').fill('UTR2026102801');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Paid ₹1,000.00 to Koley Market Traders.')).toBeVisible();
  const totals = page.locator('dl', { hasText: 'Still due' });
  await expect(totals.locator('dt', { hasText: 'Still due' }).locator('+ dd')).toHaveText(
    '₹842.75',
  );

  // The order is part received, with 5.5 kg still to come.
  await page.getByRole('link', { name: /^Against KOL1\/PO/ }).click();
  await expect(title).toContainText('Part received');
  await expect(page.getByRole('row', { name: /Gobindobhog rice/ })).toContainText('5.5 kg');

  // The dues: ₹842.75 owed, not yet due (15 days' terms).
  await page.getByRole('link', { name: 'Dues' }).click();
  const dues = page.getByRole('row', { name: /Koley Market Traders/ });
  await expect(dues.getByRole('cell').nth(1)).toHaveText('₹842.75');
  await expect(dues.getByRole('cell').nth(6)).toHaveText('₹842.75');
});
