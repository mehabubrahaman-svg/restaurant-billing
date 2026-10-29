import type { SalesReport } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import { BASE_ROUTES, json, mockHub, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { presetRange } from './sales-page';

const figures = (net: number, invoices: number) => ({
  invoices,
  orders: invoices,
  covers: invoices * 2,
  gross: net,
  discounts: 0,
  charges: 0,
  taxable: net,
  tax: 0,
  roundOff: 0,
  total: net,
  refunds: 0,
  net,
  averageBill: invoices === 0 ? 0 : Math.round(net / invoices),
});

function makeSales(overrides: Partial<SalesReport> = {}): SalesReport {
  return {
    from: '2026-10-01',
    to: '2026-10-31',
    groupBy: 'week',
    branchName: 'Park Street',
    generatedAt: '2026-10-31T18:00:00.000Z',
    totals: figures(3_00_000_00, 400),
    periods: [
      { key: '2026-09-28', from: '2026-10-01', to: '2026-10-04', ...figures(40_000_00, 60) },
      { key: '2026-10-05', from: '2026-10-05', to: '2026-10-11', ...figures(2_60_000_00, 340) },
    ],
    orderTypes: [{ orderType: 'DINE_IN', orders: 300, covers: 800, sales: 2_50_000_00 }],
    channels: [
      {
        name: 'Swiggy',
        orders: 40,
        sales: 50_000_00,
        commission: 11_000_00,
        netRevenue: 39_000_00,
      },
    ],
    payments: [{ method: 'UPI', count: 220, amount: 1_80_000_00 }],
    categories: [{ name: 'Mains', quantity: 900, amount: 2_00_000_00 }],
    items: Array.from({ length: 25 }, (_, i) => ({
      name: `Dish ${i + 1}`,
      category: 'Mains',
      quantity: 50 - i,
      amount: (50 - i) * 300_00,
    })),
    hourly: [{ hour: 20, invoices: 120, total: 90_000_00 }],
    weekdays: [{ weekday: 6, invoices: 90, total: 70_000_00 }],
    staff: [
      { name: 'Rahul Das', orders: 150, covers: 400, orderSales: 1_20_000_00, bills: 0, billed: 0 },
    ],
    discounts: [{ kind: 'COUPON', count: 12, amount: 3_600_00 }],
    taxes: [{ code: 'CGST', rateBp: 250, taxable: 2_50_000_00, tax: 6_250_00 }],
    ...overrides,
  };
}

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

function hub(
  routes: Record<string, Handler> = {},
  permissions = ['reports.sales', 'reports.export'],
) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /reports/sales': ({ url }) =>
      json(
        makeSales({
          from: url.searchParams.get('from')!,
          to: url.searchParams.get('to')!,
          groupBy: url.searchParams.get('groupBy') as SalesReport['groupBy'],
        }),
      ),
    ...routes,
  });
}

describe('Sales report', () => {
  it('reports the chosen range by week, with every breakdown, and exports it', async () => {
    const fetchMock = hub({
      'GET /reports/sales.xlsx': () =>
        new Response('PK', {
          headers: {
            'content-disposition':
              'attachment; filename="sales-2026-10-01-to-2026-10-31-by-week.xlsx"',
          },
        }),
    });
    renderApp('/reports/sales?from=2026-10-01&to=2026-10-31&groupBy=week');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sales report' }),
    ).toBeInTheDocument();
    // Net sales leads the cards.
    const net = (await screen.findByText('Net sales', { selector: 'span' })).parentElement!;
    expect(net).toHaveTextContent('₹3,00,000.00');
    expect(screen.getByRole('radio', { name: 'Week' })).toBeChecked();

    const byPeriod = screen.getByRole('heading', { name: 'By period' }).parentElement!;
    expect(within(byPeriod).getByText('Week of 5 Oct')).toBeInTheDocument();
    expect(within(byPeriod).getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Swiggy')).toBeInTheDocument();
    expect(screen.getByText('₹39,000.00')).toBeInTheDocument();
    expect(screen.getByText('Saturday')).toBeInTheDocument();
    expect(screen.getByText('Coupon')).toBeInTheDocument();

    // The top 20 items, then all of them.
    expect(screen.queryByText('Dish 21')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 25 items' }));
    expect(screen.getByText('Dish 25')).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(saved).toEqual(['sales-2026-10-01-to-2026-10-31-by-week.xlsx']));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/reports/sales.xlsx'))!;
    expect(new URL(String(call[0]), 'http://hub.test').search).toBe(
      '?from=2026-10-01&to=2026-10-31&groupBy=week',
    );

    // Switching to months asks the Hub again.
    fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('groupBy=month'))).toBe(true),
    );
  });

  it('refuses a range the Hub would refuse, and hides exports without reports.export', async () => {
    const fetchMock = hub({}, ['reports.sales']);
    renderApp('/reports/sales?from=2026-10-31&to=2026-10-01');
    expect(
      await screen.findByText('Pick a start on or before the end, at most 1830 days.'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/reports/sales'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Excel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Print or PDF' })).toBeDisabled();
  });

  it('picks quick ranges: weeks start on Monday, years in April', () => {
    // 28 Oct 2026 is a Wednesday.
    expect(presetRange('thisWeek', '2026-10-28')).toEqual({
      from: '2026-10-26',
      to: '2026-10-28',
      groupBy: 'day',
    });
    expect(presetRange('lastWeek', '2026-10-28')).toMatchObject({
      from: '2026-10-19',
      to: '2026-10-25',
    });
    expect(presetRange('lastMonth', '2026-03-15')).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(presetRange('thisYear', '2027-02-10')).toEqual({
      from: '2026-04-01',
      to: '2027-02-10',
      groupBy: 'month',
    });
    expect(presetRange('lastYear', '2026-10-28')).toMatchObject({
      from: '2025-04-01',
      to: '2026-03-31',
    });
  });
});
