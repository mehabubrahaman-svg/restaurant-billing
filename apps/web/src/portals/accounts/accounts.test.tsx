import type { Expense, JournalEntry } from '@restroos/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import {
  billEntry,
  byCode,
  CHART,
  ENTRY_MANUAL_ID,
  EXPENSE_ID,
  makeBalanceSheet,
  makeCashFlow,
  makeEntry,
  makeExpense,
  makeGstSummary,
  makeLedger,
  makeProfitAndLoss,
  makeTrialBalance,
  stockEntry,
} from '../../test/accounting-fixtures';
import { expectNoAxeViolations } from '../../test/axe';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { localIsoDate } from '../pos/bills-page';
import { journalTotals } from './manual-journal-page';

/** The ACCOUNTANT role's accounts permissions. */
const ACCOUNTANT = [
  'accounts.view',
  'accounts.journal',
  'expenses.manage',
  'reports.financial',
  'vendors.view',
];

function hub(routes: Record<string, Handler> = {}, permissions = ACCOUNTANT) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /accounts': () => json({ data: CHART }),
    'GET /journal-entries': () =>
      json({ data: [billEntry, stockEntry, makeEntry()], nextCursor: null }),
    'GET /expenses': () => json({ data: [makeExpense()] }),
    'GET /reports/trial-balance': () => json(makeTrialBalance()),
    'GET /reports/profit-and-loss': () => json(makeProfitAndLoss()),
    'GET /reports/balance-sheet': () => json(makeBalanceSheet()),
    'GET /reports/cash-flow': () => json(makeCashFlow()),
    'GET /reports/gst-summary': () => json(makeGstSummary()),
    ...routes,
  });
}
type FetchMock = ReturnType<typeof mockHub>;
const callsTo = (fetchMock: FetchMock, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) =>
      new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
      (init?.method ?? 'GET') === method,
  );
const bodyOf = (call: FetchMock['mock']['calls'][number]) =>
  JSON.parse(String((call[1] as RequestInit).body)) as unknown;

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Chart of accounts', () => {
  it('groups accounts by type with balances; only accounts the owner added can be retired', async () => {
    let tries = 0;
    const fetchMock = hub({
      'POST /accounts': ({ body }) => {
        tries += 1;
        if (tries === 1) return problem(409, 'ACCOUNT_CODE_TAKEN');
        return json(
          {
            ...(body as object),
            id: '0f800000-0000-4000-8000-000000000002',
            systemTag: null,
            isActive: true,
            balance: 0,
            version: 1,
          },
          201,
        );
      },
    });
    renderApp('/accounts');
    const assets = await screen.findByRole('region', { name: 'Assets' });
    const cash = within(assets).getByRole('row', { name: /Cash in hand/ });
    expect(within(cash).getByText('₹4,265.00')).toBeInTheDocument();
    expect(within(cash).getByText('System')).toBeInTheDocument();
    expect(within(cash).getByRole('link', { name: 'Cash in hand' })).toHaveAttribute(
      'href',
      `/accounts/ledgers?account=${encodeURIComponent(byCode('1000').id)}`,
    );
    // System accounts are renamed, never retired; an added one can be.
    expect(within(cash).queryByRole('button', { name: /^Retire/ })).toBeNull();
    const expenses = screen.getByRole('region', { name: 'Expenses' });
    expect(
      within(expenses).getByRole('button', { name: 'Retire Staff meals' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Income' })).getByText('-₹60.00'),
    ).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const dialog = screen.getByRole('dialog', { name: 'Add account' });
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: '6050' } });
    fireEvent.change(within(dialog).getByLabelText(/^Account/), { target: { value: 'Gas' } });
    expect(within(dialog).getByLabelText('Type')).toHaveValue('EXPENSE');
    // Only expense accounts can hold an expense account.
    expect(
      within(within(dialog).getByLabelText('Under'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'None (top level)',
      '5000 · Cost of goods sold',
      '6020 · Electricity and gas',
      '6050 · Staff meals',
    ]);
    fireEvent.change(within(dialog).getByLabelText('Under'), {
      target: { value: byCode('6020').id },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Another account already has this code. Choose a different one.',
    );
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: '6060' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved Gas.')).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, 'POST', '/accounts')[1]!)).toEqual({
      code: '6060',
      name: 'Gas',
      type: 'EXPENSE',
      parentId: byCode('6020').id,
    });
  });

  it('retires an added account, encoding its id in the address', async () => {
    const staff = byCode('6050');
    const fetchMock = hub({
      [`PATCH /accounts/${staff.id}`]: () => json({ ...staff, isActive: false, version: 2 }),
    });
    renderApp('/accounts/chart');
    fireEvent.click(await screen.findByRole('button', { name: 'Retire Staff meals' }));
    const confirm = screen.getByRole('dialog', { name: 'Retire Staff meals?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Retire' }));
    expect(await screen.findByText('Staff meals retired.')).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, 'PATCH', `/accounts/${staff.id}`)[0]!)).toEqual({
      version: 1,
      isActive: false,
    });
  });
});

describe('Day book', () => {
  it('lists entries with their source, opens one to its lines, and reverses a manual entry', async () => {
    let manual: JournalEntry = makeEntry();
    const fetchMock = hub({
      'GET /journal-entries': () =>
        json({ data: [billEntry, stockEntry, manual], nextCursor: null }),
      [`POST /journal-entries/${ENTRY_MANUAL_ID}/reverse`]: () => {
        manual = { ...manual, reversedById: '0f600000-0000-4000-8000-000000000099' };
        return json(
          makeEntry({
            id: '0f600000-0000-4000-8000-000000000099',
            entryNo: 'KOL1/JV/2026-27/000005',
            narration: 'Reversal: Posted twice',
            reversalOfId: ENTRY_MANUAL_ID,
          }),
          201,
        );
      },
    });
    renderApp('/accounts/journal');
    const list = await screen.findByRole('list', { name: '3 entries' });
    const bill = within(list).getByRole('button', { name: /Bill KOL1\/2026-27\/000001/ });
    expect(bill).toHaveTextContent('Meera Saha');
    expect(bill).toHaveTextContent('₹1,008.00');
    // Entries the system posted on its own (stock) say so.
    const stock = within(list).getByRole('button', { name: /Cost of goods sold/ });
    expect(stock).toHaveTextContent('System');
    // Debits come first, as a journal is written, whatever order the Hub posted them in.
    fireEvent.click(stock);
    const stockLines = screen.getByRole('table', { name: 'Lines of KOL1/JV/2026-27/000003' });
    const [, first, second] = within(stockLines).getAllByRole('row');
    expect(first).toHaveTextContent('5000 · Cost of goods sold');
    expect(second).toHaveTextContent('1200 · Inventory');
    fireEvent.click(stock);

    fireEvent.click(bill);
    expect(bill).toHaveAttribute('aria-expanded', 'true');
    const lines = screen.getByRole('table', { name: 'Lines of KOL1/JV/2026-27/000004' });
    expect(within(lines).getByRole('link', { name: 'Asha Roy' })).toHaveAttribute(
      'href',
      expect.stringContaining(
        '/accounts/ledgers?party=CUSTOMER&id=0e300000-0000-4000-8000-000000000001',
      ),
    );
    expect(within(lines).getByRole('row', { name: /^Total/ })).toHaveTextContent(
      '₹1,008.00₹1,008.00',
    );
    // Bills are corrected by cancelling them, not by reversing their entry.
    expect(screen.queryByRole('button', { name: 'Reverse' })).toBeNull();
    await expectNoAxeViolations();

    fireEvent.click(within(list).getByRole('button', { name: /Capital brought in/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    const dialog = screen.getByRole('dialog', { name: 'Reverse KOL1/JV/2026-27/000001?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reverse' }));
    expect(within(dialog).getByText('Give a reason of at least 3 characters.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), {
      target: { value: 'Posted twice' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reverse' }));
    expect(
      await screen.findByText('KOL1/JV/2026-27/000001 reversed by KOL1/JV/2026-27/000005.'),
    ).toBeInTheDocument();
    expect(
      bodyOf(callsTo(fetchMock, 'POST', `/journal-entries/${ENTRY_MANUAL_ID}/reverse`)[0]!),
    ).toEqual({ reason: 'Posted twice' });
    expect(await within(list).findByText('Reversed')).toBeInTheDocument();
  });

  it('filters by source and account, and loads older pages', async () => {
    const fetchMock = hub({
      'GET /journal-entries': ({ url }) =>
        json(
          url.searchParams.get('before') === null
            ? { data: [billEntry], nextCursor: billEntry.id }
            : { data: [makeEntry()], nextCursor: null },
        ),
    });
    renderApp('/accounts/journal');
    await screen.findByRole('list', { name: '1 entry' });
    fireEvent.click(screen.getByRole('button', { name: 'Show older entries' }));
    expect(await screen.findByRole('list', { name: '2 entries' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older entries' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'MANUAL' } });
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: byCode('1000').id } });
    await waitFor(() => {
      const last = new URL(
        String(callsTo(fetchMock, 'GET', '/journal-entries').at(-1)![0]),
        'http://x',
      );
      expect(Object.fromEntries(last.searchParams)).toEqual({
        sourceType: 'MANUAL',
        accountId: byCode('1000').id,
        limit: '50',
      });
    });
  });

  it('posts a manual journal only once it balances, and shows the Hub’s refusal', async () => {
    const fetchMock = hub({
      'POST /journal-entries': () => problem(422, 'JOURNAL_UNBALANCED'),
    });
    renderApp('/accounts/journal/new');
    const post = await screen.findByRole('button', { name: 'Post entry' });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Narration/), {
      target: { value: 'Capital brought in' },
    });
    const first = screen.getByRole('listitem', { name: 'Line 1' });
    const second = screen.getByRole('listitem', { name: 'Line 2' });
    fireEvent.change(within(first).getByLabelText('Account'), {
      target: { value: byCode('1000').id },
    });
    fireEvent.change(within(first).getByLabelText('Debit'), { target: { value: '5000' } });
    fireEvent.change(within(second).getByLabelText('Account'), {
      target: { value: byCode('3000').id },
    });
    fireEvent.change(within(second).getByLabelText('Credit'), { target: { value: '4000' } });
    expect(screen.getByText('Not balanced: the debits are ₹1,000.00 more')).toBeInTheDocument();
    expect(post).toBeDisabled();

    fireEvent.change(within(second).getByLabelText('Credit'), { target: { value: '5000' } });
    expect(screen.getByText('Balanced')).toBeInTheDocument();
    expect(post).toBeEnabled();
    await expectNoAxeViolations();
    fireEvent.click(post);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The debits and the credits are not equal. Make them equal, then post.',
    );
    expect(bodyOf(callsTo(fetchMock, 'POST', '/journal-entries')[0]!)).toEqual({
      entryDate: localIsoDate(),
      narration: 'Capital brought in',
      lines: [
        { accountId: byCode('1000').id, debit: 500_000, credit: 0, memo: null },
        { accountId: byCode('3000').id, debit: 0, credit: 500_000, memo: null },
      ],
    });
  });

  it('adds up a journal without floats and needs both sides', () => {
    const row = (accountId: string, debit: string, credit: string) => ({
      key: accountId + debit + credit,
      accountId,
      debit,
      credit,
      memo: '',
    });
    expect(journalTotals([row('a', '0.1', ''), row('b', '0.2', ''), row('c', '', '0.3')])).toEqual({
      debit: 30,
      credit: 30,
      lines: 3,
      balanced: true,
    });
    expect(journalTotals([row('a', '10', '10'), row('b', '', '10')]).balanced).toBe(false);
    expect(journalTotals([row('a', '10', ''), row('', '', '')]).balanced).toBe(false);
    expect(journalTotals([row('', '10', ''), row('b', '', '10')]).balanced).toBe(false);
  });
});

describe('Expenses', () => {
  it('records an expense with its GST split, and cancels one with a reason', async () => {
    let expenses: Expense[] = [makeExpense()];
    const fetchMock = hub({
      'GET /expenses': () => json({ data: expenses }),
      'POST /expenses': ({ body }) => {
        const saved = makeExpense({
          ...(body as Partial<Expense>),
          id: '0f700000-0000-4000-8000-000000000002',
          expenseAccountName: 'Electricity and gas',
          paidFromAccountName: 'Bank account',
        });
        expenses = [saved, ...expenses];
        return json(saved, 201);
      },
      [`POST /expenses/${EXPENSE_ID}/cancel`]: () => {
        expenses = expenses.map((e) =>
          e.id === EXPENSE_ID
            ? { ...e, status: 'CANCELLED', cancelReason: 'Paid by the owner', version: 2 }
            : e,
        );
        return json(expenses.find((e) => e.id === EXPENSE_ID));
      },
    });
    renderApp('/accounts/expenses');
    const table = await screen.findByRole('table', { name: '1 expense' });
    expect(
      screen.getByText(
        'Rent, wages, electricity and other running costs, paid from cash or the bank.',
      ),
    ).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /CESC bill, October/ })).toHaveTextContent(
      '₹1,180.00',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Record expense' }));
    // The form opens once the chart of accounts is in.
    fireEvent.change(await screen.findByLabelText(/^Expense account/), {
      target: { value: byCode('6020').id },
    });
    const dialog = screen.getByRole('dialog', { name: 'Record expense' });
    const paidFrom = within(dialog).getByLabelText(/^Paid from/);
    // Cash, the bank, card/UPI clearing, or an asset the owner added: not stock or input tax.
    expect(
      within(paidFrom)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['1000 · Cash in hand', '1010 · Bank account', '1020 · Card and UPI clearing']);
    fireEvent.change(paidFrom, { target: { value: byCode('1010').id } });
    fireEvent.change(within(dialog).getByLabelText(/^Amount paid/), { target: { value: '1180' } });
    fireEvent.change(within(dialog).getByLabelText('GST in it'), { target: { value: '180' } });
    fireEvent.change(within(dialog).getByLabelText(/^Description/), {
      target: { value: 'CESC bill, November' },
    });
    fireEvent.change(within(dialog).getByLabelText('Bill or receipt number'), {
      target: { value: 'CESC-11' },
    });
    expect(
      within(dialog).getByText(
        'Electricity and gas: ₹1,000.00; input CGST ₹90.00, input SGST ₹90.00.',
      ),
    ).toBeInTheDocument();
    await expectNoAxeViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record expense' }));
    expect(await screen.findByText('Expense of ₹1,180.00 recorded.')).toBeInTheDocument();
    const [call] = callsTo(fetchMock, 'POST', '/expenses');
    expect(bodyOf(call!)).toEqual({
      expenseAccountId: byCode('6020').id,
      paidFromAccountId: byCode('1010').id,
      amount: 118_000,
      taxAmount: 18_000,
      description: 'CESC bill, November',
      reference: 'CESC-11',
      expenseDate: localIsoDate(),
    });
    expect(new Headers((call![1] as RequestInit).headers).get('idempotency-key')).not.toBeNull();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancel the expense CESC bill, October' }),
    );
    const cancel = screen.getByRole('dialog', { name: 'Cancel “CESC bill, October”?' });
    fireEvent.change(within(cancel).getByLabelText(/^Reason/), {
      target: { value: 'Paid by the owner' },
    });
    fireEvent.click(within(cancel).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Expense cancelled: CESC bill, October')).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, 'POST', `/expenses/${EXPENSE_ID}/cancel`)[0]!)).toEqual({
      version: 1,
      reason: 'Paid by the owner',
    });
    expect(await screen.findByText('Cancelled: Paid by the owner')).toBeInTheDocument();
  });
});

describe('Statements', () => {
  it('shows the trial balance balanced, or by how much it is not', async () => {
    hub({
      'GET /reports/trial-balance': () =>
        json(makeTrialBalance({ totalCredit: 1_499_000, balanced: false })),
    });
    renderApp('/accounts/statements');
    expect(
      await screen.findByText(
        'Not balanced: debits ₹15,000.00, credits ₹14,990.00, a difference of ₹10.00.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /^Total/ })).toHaveTextContent('₹15,000.00₹14,990.00');
  });

  it('shows profit and loss with the gross margin, and a balanced balance sheet', async () => {
    const fetchMock = hub();
    const { router } = renderApp(
      '/accounts/statements/profit-and-loss?from=2026-10-01&to=2026-10-28',
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Profit and loss' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 Oct 2026 to 28 Oct 2026')).toBeInTheDocument();
    expect((await screen.findAllByText('Gross margin 85.86%')).length).toBe(2);
    const net = screen.getByRole('row', { name: /^Net loss/ });
    expect(net).toHaveTextContent('-₹227.25');
    expect(screen.getByRole('row', { name: /^Total income/ })).toHaveTextContent('₹900.00');
    expect(screen.getByRole('row', { name: /Sales returns/ })).toHaveTextContent('-₹60.00');
    expect(
      new URL(String(callsTo(fetchMock, 'GET', '/reports/profit-and-loss')[0]![0]), 'http://x')
        .search,
    ).toBe('?from=2026-10-01&to=2026-10-28');
    await expectNoAxeViolations();

    await act(() => router.navigate('/accounts/statements/balance-sheet'));
    expect(
      await screen.findByText(
        'Balanced: the assets equal the liabilities and equity (₹16,980.25).',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /^Profit to date/ })).toHaveTextContent('-₹227.25');
    expect(screen.getByRole('row', { name: /^Total equity/ })).toHaveTextContent('₹15,572.75');
    await expectNoAxeViolations();

    await act(() => router.navigate('/accounts/statements/cash-flow'));
    expect(
      await screen.findByRole('row', { name: /^Other \(capital, transfers\)/ }),
    ).toHaveTextContent('₹15,000.00');
    expect(screen.getByRole('row', { name: /^Closing cash and bank/ })).toHaveTextContent(
      '₹13,765.00',
    );

    await act(() => router.navigate('/accounts/statements/gst'));
    expect(await screen.findByRole('row', { name: /^Net payable/ })).toHaveTextContent(
      '-₹123.75-₹123.75₹0.00₹0.00',
    );
    expect(
      screen.getByText(/operator pays the GST \(section 9\(5\)\): ₹120.00 taxable on 1 bill/),
    ).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});

describe('Accounts permissions', () => {
  it('lets someone who only reads the books change nothing, and keeps statements to reports.financial', async () => {
    hub({}, ['accounts.view']);
    const { router } = renderApp('/accounts');
    await waitFor(() => expect(router.state.location.pathname).toBe('/accounts/chart'));
    await screen.findByRole('region', { name: 'Assets' });
    expect(screen.queryByRole('button', { name: 'Add account' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    await act(() => router.navigate('/accounts/journal'));
    await screen.findByRole('list', { name: '3 entries' });
    expect(screen.queryByRole('link', { name: 'Manual journal' })).toBeNull();
    await act(() => router.navigate('/accounts/expenses'));
    await screen.findByRole('table', { name: '1 expense' });
    expect(screen.queryByRole('button', { name: 'Record expense' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cancel the expense/ })).toBeNull();
    await act(() => router.navigate('/accounts/statements'));
    const tabs = within(await screen.findByRole('navigation', { name: 'Statements' }));
    expect(tabs.getAllByRole('link').map((a) => a.textContent)).toEqual(['Trial balance']);
    await act(() => router.navigate('/accounts/statements/profit-and-loss'));
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    await act(() => router.navigate('/accounts/journal/new'));
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });

  it('gives someone who only records expenses the chart and expenses, not the books', async () => {
    hub({}, ['expenses.manage']);
    renderApp('/accounts/chart');
    const sections = within(await screen.findByRole('navigation', { name: 'Accounts sections' }));
    expect(sections.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Chart of accounts',
      'Expenses',
    ]);
    // No ledger to open from an account's name either.
    expect(await screen.findByText('Cash in hand')).not.toHaveAttribute('href');
  });

  it('is not offered to staff without any accounts permission', async () => {
    hub({}, ['billing.create']);
    renderApp('/accounts/chart');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });

  it('reads in Bengali', async () => {
    await i18n.changeLanguage('bn-IN');
    hub();
    renderApp('/accounts/statements');
    expect(await screen.findByRole('heading', { level: 1, name: 'রেওয়ামিল' })).toBeInTheDocument();
    expect(await screen.findByText(/মিলেছে: ডেবিট আর ক্রেডিট দুটোই/)).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});

describe('Ledgers', () => {
  it('shows an account’s entries with the running balance between opening and closing', async () => {
    // Seeded ids hold a colon, so the address carries it percent-encoded.
    const path = `/ledgers/${encodeURIComponent(byCode('1000').id)}`;
    const fetchMock = hub({ [`GET ${path}`]: () => json(makeLedger()) });
    renderApp(
      `/accounts/ledgers?account=${encodeURIComponent(byCode('1000').id)}&from=2026-10-01&to=2026-10-28`,
    );
    expect(await screen.findByRole('heading', { name: '1000 · Cash in hand' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Opening balance/ })).toHaveTextContent('₹0.00');
    expect(screen.getByRole('row', { name: /CESC bill, October/ })).toHaveTextContent(
      'Against Electricity and gas, Input CGST, Input SGST₹1,180.00₹4,265.00',
    );
    expect(screen.getByRole('row', { name: /^Closing balance/ })).toHaveTextContent(
      '₹5,508.00₹1,243.00₹4,265.00',
    );
    expect(
      new URL(String(callsTo(fetchMock, 'GET', path)[0]![0]), 'http://x').searchParams.get('from'),
    ).toBe('2026-10-01');
    await expectNoAxeViolations();
  });
});
