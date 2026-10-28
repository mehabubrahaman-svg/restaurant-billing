import { expect, test } from '@playwright/test';
import { OWNER, SETUP_CODE } from '../support/restaurant';

test('first-time setup through the wizard signs the owner in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  const next = page.getByRole('button', { name: 'Next' });

  await expect(page.getByRole('heading', { name: 'Language' })).toBeVisible();
  await next.click();

  await expect(page.getByRole('heading', { name: 'Business and branch' })).toBeVisible();
  await page.getByLabel(/Business name/).fill('Spice Route');
  await page.getByLabel(/Branch name/).fill('Park Street');
  await page.getByLabel(/Branch code/).fill('kol1');
  await page.getByLabel(/State or union territory/).selectOption('19'); // West Bengal
  await next.click();

  await expect(page.getByRole('heading', { name: 'Liquor' })).toBeVisible();
  await page.getByRole('switch', { name: /Sell liquor/ }).click();
  await page.getByLabel(/VAT TIN/).fill('19123456789');
  await page.getByLabel(/Excise licence number/).fill('EXC/KOL/2026/001');
  await page.getByLabel(/VAT on liquor/).fill('20');
  await next.click();

  await expect(page.getByRole('heading', { name: 'Receipt languages' })).toBeVisible();
  await next.click();

  await expect(page.getByRole('heading', { name: 'Owner account' })).toBeVisible();
  await page.getByLabel(/^Username/).fill(OWNER.username);
  await page.getByLabel(/Full name/).fill(OWNER.fullName);
  await page.getByLabel(/^Password/).fill(OWNER.password);
  await page.getByLabel(/Repeat new password/).fill(OWNER.password);
  await next.click();

  await expect(page.getByRole('heading', { name: 'Backup passphrase' })).toBeVisible();
  await page.getByLabel(/^Backup passphrase/).fill(OWNER.backupPassphrase);
  await page.getByLabel(/Repeat passphrase/).fill(OWNER.backupPassphrase);
  await page.getByRole('checkbox', { name: /written the passphrase down/ }).check();
  await next.click();

  await expect(page.getByRole('heading', { name: 'Review and finish' })).toBeVisible();
  await page.getByLabel(/Setup code/).fill('WRONG123');
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByLabel(/Setup code/)).toHaveAccessibleDescription(/Wrong setup code/);
  await page.getByLabel(/Setup code/).fill(SETUP_CODE);
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(page).toHaveURL(/\/admin/);
  // Setting up twice is refused: the Hub now sends everyone to sign in.
  await page.goto('/setup');
  await expect(page).not.toHaveURL(/\/setup$/);
});
