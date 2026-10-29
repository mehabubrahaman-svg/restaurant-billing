import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, Providers } from '../../../app/providers';
import { i18n } from '../../../i18n';
import { CustomerDialog } from '../../../portals/pos/bill-dialogs';
import { expectNoAxeViolations } from '../../../test/axe';
import { BASE_ROUTES, json, mockHub, type Handler } from '../../../test/mock-hub';
import { CUSTOMER_ID, makeCustomer, makeCustomerDetail } from '../../../test/report-fixtures';
import { renderApp } from '../../../test/render-app';
import { makeSession, signInForTest } from '../../../test/session';
import { useAuthStore } from '../../auth/auth-store';
import { searchTerm } from '../../customers/customer-queries';

const asha = makeCustomer();
const rahul = makeCustomer({
  id: '0e300000-0000-4000-8000-000000000002',
  phone: '+919830099999',
  name: null,
  taxId: null,
  visitCount: 1,
  lifetimeValue: 45000,
  lastVisitAt: null,
});

function hub(routes: Record<string, Handler> = {}, permissions = ['customers.view']) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /customers': ({ url }) => {
      const q = url.searchParams.get('q') ?? '';
      const all = [asha, rahul].filter(
        (c) => c.phone.includes(q) || (c.name ?? '').toLowerCase().includes(q.toLowerCase()),
      );
      return json({ data: all });
    },
    [`GET /customers/${CUSTOMER_ID}`]: () => json(makeCustomerDetail()),
    [`GET /customers/${CUSTOMER_ID}/loyalty`]: () => json(ledger(140)),
    ...routes,
  });
}

const PROGRAM = { enabled: true, earnPer100: 1, pointValue: 100, minRedeem: 50 };
function ledger(balance: number, extra: object[] = []) {
  return {
    balance,
    program: PROGRAM,
    entries: [
      ...extra,
      {
        id: '0f000000-0000-4000-8000-000000000001',
        kind: 'EARN',
        points: 140,
        invoiceId: '0d000000-0000-4000-8000-000000000001',
        invoiceNo: 'KOL1/2026-27/000123',
        note: null,
        createdAt: '2026-10-20T15:00:00.000Z',
        createdByName: 'Meera',
      },
    ],
  };
}
const callsTo = (fetchMock: ReturnType<typeof mockHub>, path: string) =>
  fetchMock.mock.calls.filter(
    ([u]) => new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}`,
  );

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Customers', () => {
  it('finds guests by mobile number and opens one with visits, spend and favourites', async () => {
    const fetchMock = hub({}, ['customers.view', 'billing.create']);
    renderApp('/admin/customers');
    expect(
      await screen.findByText('Type at least 3 characters of a mobile number or name.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a guest' }), {
      target: { value: '98300' },
    });
    const table = await screen.findByRole('table', { name: '2 guests' });
    expect(within(table).getByRole('link', { name: 'Asha Roy' })).toBeInTheDocument();
    // No name saved: the number stands in.
    expect(within(table).getByRole('link', { name: '+91 98300 99999' })).toBeInTheDocument();
    expect(within(table).getByText('₹18,450.00')).toBeInTheDocument();
    expect(new URL(String(callsTo(fetchMock, '/customers').at(-1)![0]), 'http://x').search).toBe(
      '?q=98300',
    );
    await expectNoAxeViolations();

    fireEvent.click(within(table).getByRole('link', { name: 'Asha Roy' }));
    expect(await screen.findByRole('heading', { name: 'Asha Roy' })).toBeInTheDocument();
    expect(screen.getByText('19AABCU9603R1ZK')).toBeInTheDocument();
    expect(screen.getByText('বাংলা')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'KOL1/2026-27/000123' })).toHaveAttribute(
      'href',
      '/pos/bills/0d000000-0000-4000-8000-000000000001',
    );
    expect(screen.getByText('14 times')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('shows the guest’s points, and lets a manager add some with a reason', async () => {
    const fetchMock = hub(
      {
        [`POST /customers/${CUSTOMER_ID}/loyalty`]: () =>
          json(
            ledger(165, [
              {
                id: '0f000000-0000-4000-8000-000000000002',
                kind: 'ADJUST',
                points: 25,
                invoiceId: null,
                invoiceNo: null,
                note: 'Birthday gift',
                createdAt: '2026-10-28T15:00:00.000Z',
                createdByName: 'Ravi Kumar',
              },
            ]),
          ),
      },
      ['customers.view', 'loyalty.adjust'],
    );
    renderApp(`/admin/customers/${CUSTOMER_ID}`);
    const section = (await screen.findByRole('heading', { name: 'Loyalty points' })).closest(
      'section',
    )!;
    expect(await within(section).findByText('140 points')).toBeInTheDocument();
    expect(within(section).getByText('worth ₹140.00')).toBeInTheDocument();
    const history = within(section).getByRole('table', { name: 'Points history' });
    expect(within(history).getByText('Earned on a bill')).toBeInTheDocument();
    expect(within(history).getByText('+140')).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: 'Adjust points' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adjust points' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Take away' }));
    fireEvent.change(within(dialog).getByLabelText(/^Points/), { target: { value: '500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('The guest has only 140 points.')).toBeInTheDocument();
    expect(within(dialog).getByText('Say why, in a few words.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Add' }));
    fireEvent.change(within(dialog).getByLabelText(/^Points/), { target: { value: '25' } });
    fireEvent.change(within(dialog).getByLabelText(/^Why/), { target: { value: 'Birthday gift' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(section).findByText('165 points')).toBeInTheDocument();
    expect(within(section).getByText(/Birthday gift/)).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      ([u, init]) => String(u).endsWith('/loyalty') && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ points: 25, note: 'Birthday gift' });
  });

  it('shows points without the adjust button to staff without loyalty.adjust', async () => {
    hub({}, ['customers.view']);
    renderApp(`/admin/customers/${CUSTOMER_ID}`);
    expect(await screen.findByText('140 points')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust points' })).toBeNull();
  });

  it('is in the admin tabs only for customers.view or customers.manage', async () => {
    hub({}, ['settings.manage']);
    renderApp('/admin/customers');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Customers' })).toBeNull();
  });

  it('turns Indic digits and spaces in a typed number into the search term', () => {
    expect(searchTerm('৯৮৩০০ ১২৩')).toBe('98300123');
    expect(searchTerm(' +91 98300-12345 ')).toBe('+919830012345');
    expect(searchTerm('Asha R')).toBe('Asha R');
  });
});

describe('Customer lookup at billing', () => {
  it('suggests known guests as the number is typed and fills in name and GSTIN', async () => {
    hub();
    signInForTest(['billing.create']);
    const onApply = vi.fn();
    render(
      <Providers client={createQueryClient()}>
        <CustomerDialog current={null} onApply={onApply} onClose={() => {}} />
      </Providers>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Customer on the bill' });
    const phone = within(dialog).getByLabelText('Mobile number');
    fireEvent.change(phone, { target: { value: '98300' } });
    const suggestions = await within(dialog).findByRole('list', {
      name: 'Guests with this number',
    });
    expect(within(suggestions).getAllByRole('button')).toHaveLength(2);
    expect(
      within(suggestions).getByText('+91 98300 12345 · 12 visits · ₹18,450.00'),
    ).toBeInTheDocument();
    await expectNoAxeViolations();
    fireEvent.click(within(suggestions).getByRole('button', { name: /Asha Roy/ }));
    expect(phone).toHaveValue('+91 98300 12345');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Asha Roy');
    expect(within(dialog).getByLabelText(/GSTIN/)).toHaveValue('19AABCU9603R1ZK');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onApply).toHaveBeenCalledWith({
      name: 'Asha Roy',
      phone: '+919830012345',
      taxId: '19AABCU9603R1ZK',
    });
  });

  it('fills a known guest in when their full number is typed, and says when a number is new', async () => {
    hub();
    signInForTest(['billing.create']);
    render(
      <Providers client={createQueryClient()}>
        <CustomerDialog current={null} onApply={() => {}} onClose={() => {}} />
      </Providers>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Customer on the bill' });
    fireEvent.change(within(dialog).getByLabelText('Mobile number'), {
      target: { value: '98300 12345' },
    });
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveValue('Asha Roy'));
    expect(within(dialog).getByRole('button', { name: /Asha Roy/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(within(dialog).getByLabelText('Mobile number'), {
      target: { value: '7001234567' },
    });
    expect(
      await within(dialog).findByText('New guest: they are added when the bill is made.'),
    ).toBeInTheDocument();
  });
});
