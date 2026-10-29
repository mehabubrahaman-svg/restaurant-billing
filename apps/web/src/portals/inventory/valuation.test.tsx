import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import { ITEMS, makeAlerts, makeValuation, UNITS } from '../../test/inventory-fixtures';
import { BASE_ROUTES, json, mockHub, type Handler } from '../../test/mock-hub';
import { makeDashboard } from '../../test/report-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

const STORE = ['inventory.view', 'inventory.adjust', 'reports.inventory'];

function hub(routes: Record<string, Handler> = {}, permissions = STORE) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /inventory-items': () => json({ data: ITEMS }),
    'GET /units': () => json({ data: UNITS }),
    'GET /stock/alerts': () => json(makeAlerts()),
    'GET /reports/dashboard': () => json(makeDashboard()),
    'GET /reports/inventory-valuation': ({ url }) =>
      json(
        makeValuation({
          from: url.searchParams.get('from') ?? '',
          to: url.searchParams.get('to') ?? '',
        }),
      ),
    ...routes,
  });
}
const valuationQueries = (fetchMock: ReturnType<typeof mockHub>) =>
  fetchMock.mock.calls
    .map(([u]) => new URL(String(u), 'http://hub.test'))
    .filter((u) => u.pathname === '/api/v1/reports/inventory-valuation')
    .map((u) => u.search);
/** A row's cells as text, the row header included. */
const rowText = (row: HTMLElement) => [...row.querySelectorAll('th, td')].map((c) => c.textContent);

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

describe('Stock value', () => {
  it('values the month to date per item and category, and against the books', async () => {
    const fetchMock = hub();
    renderApp('/inventory/valuation');
    const table = await screen.findByRole('table', { name: 'Stock value' });
    // The month to the Hub's business day.
    expect(valuationQueries(fetchMock)).toEqual(['?from=2026-10-01&to=2026-10-28']);

    const card = (label: string) =>
      screen.getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!;
    expect(card('Stock value on 28 Oct 2026')).toHaveTextContent('₹5,613.30');
    expect(card('Items in stock')).toHaveTextContent('4');
    expect(card('Not used in the period')).toHaveTextContent(
      '₹600.001 item with stock and no sales',
    );
    expect(card('Difference from the books')).toHaveTextContent(
      '-₹0.11Inventory account in the books: ₹5,613.41',
    );
    expect(
      screen.getByText(
        '1 item is below zero and valued at nil. Receive or count it to set the value right.',
      ),
    ).toBeInTheDocument();

    const moved = screen.getByRole('table', { name: 'How the value moved' });
    expect(within(moved).getAllByRole('row').map(rowText)).toEqual([
      ['Opening stock on 1 Oct 2026', '₹3,300.00'],
      ['Received', '+₹2,600.00'],
      ['Used in sales', '-₹296.14'],
      ['Wastage', '-₹86.67'],
      ['Counts and adjustments', '+₹96.00'],
      ['Cost difference', '+₹0.11'],
      ['Closing stock on 28 Oct 2026', '₹5,613.30'],
    ]);
    const categories = screen.getByRole('table', { name: 'By category' });
    expect(within(categories).getAllByRole('row').slice(1).map(rowText)).toEqual([
      ['Grains', '2', '₹2,666.10', '47.5%'],
      ['Meat', '1', '₹2,347.20', '41.81%'],
      ['Dairy', '1', '₹600.00', '10.69%'],
    ]);

    const rice = within(table).getByText('Basmati rice').closest('tr')!;
    expect(rowText(rice)).toEqual([
      'Basmati riceRICE-BAS',
      '—',
      '30 kg₹2,600.00',
      '500 g₹43.34',
      '1 kg₹86.67',
      '—',
      '28.5 kg',
      '₹86.67/kg',
      '₹2,470.10',
    ]);
    expect(within(table).getByText('Curd').closest('tr')).toHaveTextContent('Below zero');
    expect(within(table).getByText('Butter').closest('tr')).toHaveTextContent('Not used');
    const totals = within(table).getByRole('rowheader', { name: 'Total' }).closest('tr')!;
    expect(rowText(totals)).toEqual([
      'Total',
      '₹3,300.00',
      '₹2,600.00',
      '₹296.14',
      '₹86.67',
      '+₹96.00',
      '',
      '',
      '₹5,613.30',
    ]);
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    await waitFor(() =>
      expect(valuationQueries(fetchMock).at(-1)).toBe('?from=2026-09-01&to=2026-09-30'),
    );
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01' } });
    expect(screen.getByLabelText('From')).toHaveAccessibleDescription(
      expect.stringContaining('Choose a range of up to 366 days'),
    );
  });

  it('exports with reports.export, and is under Reports for the accountant', async () => {
    const fetchMock = hub(
      {
        'GET /reports/inventory-valuation.xlsx': () =>
          new Response('PK', {
            headers: {
              'content-disposition':
                'attachment; filename="stock-value-2026-10-01-to-2026-10-28.xlsx"',
            },
          }),
      },
      ['reports.sales', 'reports.inventory', 'reports.export'],
    );
    renderApp('/reports/valuation');
    const table = await screen.findByRole('table', { name: 'Stock value' });
    expect(within(table).getByText('Basmati rice')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Report sections' }))
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Dashboard', 'Day-end', 'Sales', 'Scheduled', 'Consumption', 'Stock value']);
    // The store room's own lists are not asked for.
    const asked = fetchMock.mock.calls.map(([u]) => new URL(String(u), 'http://hub.test').pathname);
    expect(asked).not.toContain('/api/v1/inventory-items');

    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(saved).toEqual(['stock-value-2026-10-01-to-2026-10-28.xlsx']));
    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/reports/inventory-valuation.xlsx'),
    )!;
    expect(new URL(String(call[0]), 'http://hub.test').search).toBe(
      '?from=2026-10-01&to=2026-10-28',
    );
  });

  it('offers no export to stock staff, and shows names in Hindi', async () => {
    await i18n.changeLanguage('hi-IN');
    hub();
    renderApp('/inventory/valuation');
    const table = await screen.findByRole('table', { name: 'स्टॉक का मूल्य' });
    expect(await within(table).findByText('बासमती चावल')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excel' })).toBeNull();
    expect(screen.getByRole('link', { name: 'स्टॉक का मूल्य' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('is not offered without reports.inventory', async () => {
    hub({}, ['reports.sales']);
    renderApp('/reports/valuation');
    expect(await screen.findByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Stock value' })).toBeNull();
  });
});
