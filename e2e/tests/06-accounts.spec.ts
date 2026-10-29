import { expect, test } from '@playwright/test';
import { OWNER, signIn } from '../support/restaurant';

test('accounts: the day’s bill is journalled, an expense is recorded, the books balance and the P&L shows sales', async ({
  page,
}) => {
  await signIn(page, OWNER.username, OWNER.password);

  // The dine-in bill (₹480 + 5% GST = ₹504) was posted to the journal when it was issued.
  await page.goto('/accounts/journal?source=INVOICE');
  const bill = page.getByRole('button', { name: /Bill KOL1\/\d{4}-\d{2}\/\d{6}.*₹504\.00/ });
  await expect(bill).toContainText('Meera Saha');
  await bill.click();
  const lines = page.getByRole('table', { name: /^Lines of KOL1\/JV/ });
  await expect(lines.getByRole('row', { name: /Food and beverage sales/ })).toContainText(
    '₹480.00',
  );
  await expect(lines.getByRole('row', { name: /Output CGST/ })).toContainText('₹12.00');
  await expect(lines.getByRole('row', { name: /^Total/ })).toContainText('₹504.00₹504.00');

  // The electricity bill: ₹1,180 with ₹180 GST, paid from the till.
  await page.getByRole('link', { name: 'Expenses' }).click();
  await page.getByRole('button', { name: 'Record expense' }).click();
  const expense = page.getByRole('dialog', { name: 'Record expense' });
  await expense
    .getByLabel(/^Expense account/)
    .selectOption({ label: '6020 · Electricity and gas' });
  await expect(expense.getByLabel(/^Paid from/)).toHaveValue(/:1000$/);
  await expense.getByLabel(/^Amount paid/).fill('1180');
  await expense.getByLabel('GST in it').fill('180');
  await expense.getByLabel(/^Description/).fill('CESC bill, October');
  await expense.getByLabel('Bill or receipt number').fill('CESC-10');
  await expect(
    expense.getByText('Electricity and gas: ₹1,000.00; input CGST ₹90.00, input SGST ₹90.00.'),
  ).toBeVisible();
  await expense.getByRole('button', { name: 'Record expense' }).click();
  await expect(page.getByText('Expense of ₹1,180.00 recorded.')).toBeVisible();
  await expect(page.getByRole('row', { name: /CESC bill, October/ })).toContainText('₹1,180.00');

  // Every posting so far (bills, payments, the purchase, the expense) keeps the books balanced.
  await page.getByRole('link', { name: 'Statements' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Trial balance' })).toBeVisible();
  await expect(page.getByText(/^Balanced: the debits and the credits are both ₹/)).toBeVisible();

  // The profit and loss shows the day's sales and the electricity bill.
  await page.getByRole('link', { name: 'Profit and loss' }).click();
  const sales = page.getByRole('row', { name: /Food and beverage sales/ });
  await expect(sales).toContainText(/₹[1-9][\d,]*\.\d{2}/);
  await expect(page.getByRole('row', { name: /Electricity and gas/ })).toContainText('₹1,000.00');
  await expect(page.getByText(/^Gross margin \d/).first()).toBeVisible();

  // The balance sheet balances too.
  await page.getByRole('link', { name: 'Balance sheet' }).click();
  await expect(
    page.getByText(/^Balanced: the assets equal the liabilities and equity/),
  ).toBeVisible();
});
