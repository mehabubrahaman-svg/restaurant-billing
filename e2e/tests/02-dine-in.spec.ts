import { expect, test, type Browser, type Page } from '@playwright/test';
import { signIn, STAFF } from '../support/restaurant';

/** A device signed in as one member of staff, like a real tablet or counter. */
async function device(browser: Browser, username: string, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await signIn(page, username);
  await page.goto(path);
  return page;
}

test('dine-in: the captain orders, the kitchen cooks, the cashier bills and takes payment', async ({
  browser,
}) => {
  const captain = await device(browser, STAFF.captain.username, '/captain');
  const kitchen = await device(browser, STAFF.chef.username, '/kitchen');
  const cashier = await device(browser, STAFF.cashier.username, '/pos');

  // Captain: T1 for two, 1 Chicken Biryani (Full) with raita and 2 Butter Naan.
  await captain.getByRole('button', { name: 'Table T1, 4 seats, Free' }).click();
  const covers = captain.getByRole('dialog', { name: 'Table T1: how many guests?' });
  await covers.getByRole('radio', { name: '2' }).click();
  await covers.getByRole('button', { name: 'Start order' }).click();
  await captain.getByRole('button', { name: 'Biryani' }).click();
  await captain
    .getByRole('button', { name: 'Chicken Biryani, from ₹190.00: choose options' })
    .click();
  const sheet = captain.getByRole('dialog', { name: /Chicken Biryani/ });
  await sheet.getByRole('radio', { name: /Full/ }).check();
  await sheet.getByRole('checkbox', { name: /Raita/ }).check();
  await sheet.getByRole('button', { name: 'Add · ₹360.00' }).click();
  await captain.getByRole('button', { name: 'Breads' }).click();
  await captain.getByRole('button', { name: 'Add Butter Naan, ₹60.00' }).click();
  await captain.getByRole('button', { name: 'Add Butter Naan, ₹60.00' }).click();
  await captain.getByRole('button', { name: 'Send to kitchen (3)' }).click();
  await expect(captain.getByRole('button', { name: 'Send to kitchen (0)' })).toBeDisabled();

  // Kitchen: both KOTs arrive live, one per station; bump each dish.
  const biryaniKot = kitchen.getByRole('article', { name: /KOT 1 · T1/ });
  const naanKot = kitchen.getByRole('article', { name: /KOT 2 · T1/ });
  await expect(biryaniKot).toContainText('Raita');
  await expect(naanKot).toContainText('Butter Naan');
  await biryaniKot.getByRole('button', { name: 'Mark 1 Chicken Biryani ready' }).click();
  await naanKot.getByRole('button', { name: 'Mark 2 Butter Naan ready' }).click();

  // Captain: the floor shows the food is ready.
  await captain.goto('/captain');
  await expect(captain.getByRole('button', { name: /^Table T1,/ })).toContainText('3 ready');

  // Cashier: bill T1 (₹480 + 5% GST = ₹504), pay part by UPI and the rest in cash.
  await cashier.getByRole('button', { name: /T1/ }).first().click();
  await expect(cashier.getByText('₹504.00').first()).toBeVisible();
  await cashier.getByRole('button', { name: 'Generate bill' }).click();
  await expect(cashier.getByText(/Bill KOL1\/2026-27\/\d{6} issued/)).toBeVisible();

  await cashier.getByRole('button', { name: 'UPI' }).click();
  await cashier
    .getByLabel(/Amount/)
    .last()
    .fill('300');
  await cashier.getByLabel(/UPI ref \/ RRN/).fill('RRN482915');
  await cashier.getByRole('button', { name: 'Cash' }).click();
  // Cash needs an open shift on this counter: it asks for the opening float first.
  const shift = cashier.getByRole('dialog', { name: 'Open a cash shift' });
  await shift.getByLabel(/Opening float/).fill('2000');
  await shift.getByRole('button', { name: 'Open shift' }).click();
  await expect(cashier.getByText(/Shift open/)).toBeVisible();
  await cashier.getByRole('textbox', { name: /Cash received/ }).fill('500');
  await cashier.getByRole('button', { name: /Record payment ₹504\.00/ }).click();
  await expect(cashier.getByText(/Give back ₹296\.00|Change ₹296\.00/).first()).toBeVisible();
  await expect(cashier.getByText('Paid').first()).toBeVisible();

  // Settled: the table goes to cleaning, ready for the next guests once cleared.
  await expect(captain.getByRole('button', { name: 'Table T1, 4 seats, Cleaning' })).toBeVisible();
  for (const page of [captain, kitchen, cashier]) await page.context().close();
});
