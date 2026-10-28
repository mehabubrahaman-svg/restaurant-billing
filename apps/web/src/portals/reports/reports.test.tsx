import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { makeDashboard, makeDayEnd } from '../../test/report-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { hourSlots } from './day-end-page';

const OWNER = ['reports.sales', 'reports.export'];

function hub(routes: Record<string, Handler> = {}, permissions = OWNER) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /reports/dashboard': () => json(makeDashboard()),
    'GET /reports/day-end': ({ url }) =>
      json(makeDayEnd({ businessDate: url.searchParams.get('date') ?? '2026-10-28' })),
    ...routes,
  });
}
const callsTo = (fetchMock: ReturnType<typeof mockHub>, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) =>
      new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
      (init?.method ?? 'GET') === method,
  );
const csv = (name: string) =>
  new Response('Day-end report,Park Street\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
    },
  });

let saved: string[];
beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
  saved = [];
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Owner dashboard', () => {
  it('shows today, month and year, the 14-day chart, payment mix, top items and the kitchen', async () => {
    hub();
    renderApp('/reports');
    const today = await screen.findByRole('heading', { name: 'Today' });
    const card = today.parentElement!;
    // ₹1,84,220.00: Indian grouping, from integer paise.
    expect(within(card).getByText('₹1,84,220.00')).toBeInTheDocument();
    expect(within(card).getByText('312')).toBeInTheDocument();
    expect(screen.getByText('1 Apr – 28 Oct 2026')).toBeInTheDocument();
    const chart = screen.getByRole('figure', { name: 'Net sales, last 14 days' });
    expect(within(chart).getAllByRole('listitem')).toHaveLength(14);
    expect(within(chart).getByText('Wed, 28 Oct: ₹1,84,220.00, 312 bills')).toBeInTheDocument();
    expect(screen.getByText('UPI')).toBeInTheDocument();
    expect(screen.getByText('52%')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Kosha Mangsho' })).toBeInTheDocument();
    expect(screen.getByText('11 min')).toBeInTheDocument();
    expect(screen.getByText('Tables with guests').nextElementSibling).toHaveTextContent('11');
    await expectNoAxeViolations();
  });

  it('is not offered to staff without reports.sales', async () => {
    hub({}, ['billing.create']);
    renderApp('/reports');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.getByText(/cannot open Reports/)).toBeInTheDocument();
  });
});

describe('Day-end report', () => {
  it('shows every section for the chosen business day and switches days', async () => {
    const fetchMock = hub();
    renderApp('/reports/day-end');
    expect(await screen.findByRole('heading', { name: 'Tax summary' })).toBeInTheDocument();
    expect(screen.getByText(/Park Street · Wednesday, 28 October 2026/)).toBeInTheDocument();
    expect(screen.getByLabelText('Business day')).toHaveValue('2026-10-28');
    const sales = screen.getByRole('heading', { name: 'Sales' }).parentElement!;
    expect(within(sales).getByText('-₹4,000.00')).toBeInTheDocument();
    expect(within(sales).getByText('₹1,89,099.60')).toBeInTheDocument();
    expect(screen.getByText('UPI (60 payments)')).toBeInTheDocument();
    expect(screen.getByText('3 items cancelled after the KOT')).toBeInTheDocument();
    expect(screen.getByText('Coupon (2)')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Swiggy' })).toBeInTheDocument();
    expect(screen.getByText('Short ₹20.00')).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: '2.5%' })).toHaveLength(2);
    await expectNoAxeViolations();

    fireEvent.change(screen.getByLabelText('Business day'), { target: { value: '2026-10-27' } });
    await screen.findByText(/Tuesday, 27 October 2026/);
    expect(
      new URL(String(callsTo(fetchMock, 'GET', '/reports/day-end').at(-1)![0]), 'http://x').search,
    ).toBe('?date=2026-10-27');
  });

  it('prints on the report printer, or says why not; downloads the CSV and the sales register', async () => {
    let printer = false;
    const fetchMock = hub({
      'POST /reports/day-end/print': () =>
        printer
          ? json({
              printerId: '0f900000-0000-4000-8000-000000000001',
              printerName: 'Office',
              mode: 'TEXT',
              bytes: 900,
            })
          : problem(409, 'NO_PRINTER'),
      'GET /reports/day-end.csv': () => csv('day-end-2026-10-28.csv'),
      'GET /reports/sales-register.csv': () => csv('sales-register-2026-10-01-to-2026-10-28.csv'),
    });
    renderApp('/reports/day-end?date=2026-10-28');
    fireEvent.click(await screen.findByRole('button', { name: 'Print on printer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No printer is set up for this. Ask the admin to add one in Settings → Printers. You can print it from this screen instead.',
    );
    printer = true;
    fireEvent.click(screen.getByRole('button', { name: 'Print on printer' }));
    expect(await screen.findByText('Sent to Office.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/reports/day-end/print')[1]![0]).toContain(
      'date=2026-10-28',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(saved).toEqual(['day-end-2026-10-28.csv']));
    const csvCall = callsTo(fetchMock, 'GET', '/reports/day-end.csv')[0]!;
    expect(new Headers((csvCall[1] as RequestInit).headers).get('authorization')).toBe(
      'Bearer access-1',
    );

    // The register defaults to the month so far; a backwards range is refused.
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-01');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-02' } });
    expect(screen.getByText(/Choose a range of up to 366 days/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download register' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download register' }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(
      new URL(String(callsTo(fetchMock, 'GET', '/reports/sales-register.csv')[0]![0]), 'http://x')
        .search,
    ).toBe('?from=2026-10-01&to=2026-10-28');
  });

  it('hides the CSV exports without reports.export', async () => {
    hub({}, ['reports.sales']);
    renderApp('/reports/day-end');
    await screen.findByRole('heading', { name: 'Tax summary' });
    expect(screen.getByRole('button', { name: 'Print on printer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sales register (CSV)' })).toBeNull();
  });

  it('orders the hours as the business day runs (past midnight last), padded to opening hours', () => {
    const slots = hourSlots(makeDayEnd().hourly);
    expect(slots[0]!.hour).toBe(11);
    expect(slots.at(-1)!.hour).toBe(1);
    expect(slots.map((s) => s.hour)).toContain(0);
    expect(slots.find((s) => s.hour === 20)!.total).toBe(1_20_000_00);
    expect(hourSlots([])).toEqual([]);
  });

  it('reads in Hindi', async () => {
    await i18n.changeLanguage('hi-IN');
    hub();
    renderApp('/reports/day-end');
    expect(
      await screen.findByRole('heading', { name: 'दिन के अंत की रिपोर्ट' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/\(60 भुगतान\)/)).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
