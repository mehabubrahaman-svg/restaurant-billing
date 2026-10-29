import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import {
  CURD,
  ITEMS,
  makeAlerts,
  makeConsumption,
  PANEER,
  UNITS,
} from '../../test/inventory-fixtures';
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
    'GET /reports/consumption': ({ url }) =>
      json(
        makeConsumption({
          from: url.searchParams.get('from') ?? '',
          to: url.searchParams.get('to') ?? '',
        }),
      ),
    ...routes,
  });
}
const consumptionQueries = (fetchMock: ReturnType<typeof mockHub>) =>
  fetchMock.mock.calls
    .map(([u]) => new URL(String(u), 'http://hub.test'))
    .filter((u) => u.pathname === '/api/v1/reports/consumption')
    .map((u) => u.search);

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Stock alerts', () => {
  it('lists low and out stock, negative balances, lots about to expire and over-stock', async () => {
    hub();
    renderApp('/inventory/alerts');
    expect(
      await screen.findByText('For Wednesday, 28 October 2026', { selector: 'p' }),
    ).toBeInTheDocument();
    const reorder = screen.getByRole('region', { name: /Low and out of stock/ });
    const curd = within(reorder).getByRole('link', { name: 'Curd' }).closest('tr')!;
    expect(curd).toHaveTextContent('-50 g');
    expect(curd).toHaveTextContent('Out');
    expect(within(curd).getByRole('link', { name: 'Receive' })).toHaveAttribute(
      'href',
      `/inventory/stock?kind=receive&item=${CURD}`,
    );
    expect(within(reorder).getByRole('link', { name: 'Butter' }).closest('tr')).toHaveTextContent(
      'Low',
    );
    const negative = screen.getByRole('region', { name: /Negative stock/ });
    expect(within(negative).getByRole('link', { name: 'Curd' }).closest('tr')).toHaveTextContent(
      '-50 g',
    );
    const expiring = screen.getByRole('region', { name: /Expiring soon/ });
    const paneer = within(expiring).getByRole('link', { name: 'Paneer' }).closest('tr')!;
    expect(paneer).toHaveAttribute('data-expired', 'true');
    expect(paneer).toHaveTextContent('27 Oct 2026Expired');
    expect(within(paneer).getByRole('link', { name: 'Write off' })).toHaveAttribute(
      'href',
      `/inventory/stock?kind=wastage&item=${PANEER}`,
    );
    const chicken = within(expiring).getByRole('link', { name: 'Chicken' }).closest('tr')!;
    expect(chicken).toHaveTextContent('LOT-7');
    expect(chicken).toHaveTextContent('Expires soon');
    expect(chicken).toHaveTextContent('4.56 kg');
    expect(chicken).toHaveTextContent('₹1,109.58');
    expect(
      within(screen.getByRole('region', { name: /Over the maximum/ })).getByRole('link', {
        name: 'Basmati rice',
      }),
    ).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('says when all is in order', async () => {
    hub({
      'GET /stock/alerts': () => json(makeAlerts({ levels: [], negative: [], expiring: [] })),
    });
    renderApp('/inventory/alerts');
    expect(await screen.findByText('All in order')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alerts' })).toHaveTextContent(/^Alerts$/);
  });

  it('shows names in Hindi from the item list', async () => {
    await i18n.changeLanguage('hi-IN');
    hub();
    renderApp('/inventory/alerts');
    const reorder = await screen.findByRole('region', { name: /कम और ख़त्म स्टॉक/ });
    const curd = await within(reorder).findByRole('link', { name: 'दही' });
    expect(curd.closest('tr')).toHaveTextContent('ख़त्म');
    await expectNoAxeViolations();
  });
});

describe('Consumption report', () => {
  it('shows the business day’s figures per item and flags variance above 5%', async () => {
    const fetchMock = hub();
    renderApp('/inventory/consumption');
    const table = await screen.findByRole('table', { name: 'Consumption' });
    // The Hub's business day, not the device's date.
    expect(consumptionQueries(fetchMock)).toEqual(['?from=2026-10-28&to=2026-10-28']);
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-28');

    const rice = within(table).getByText('Basmati rice').closest('tr')!;
    const cells = within(rice)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells).toEqual([
      'Basmati riceRICE-BAS',
      '—',
      '30 kg',
      '500 g₹43.34',
      '1 kg₹86.67',
      '—',
      '-500 g-₹43.34',
      '28 kg₹2,426.76',
      '+100%above the limit',
    ]);
    expect(within(rice).getByText('+100%').closest('[data-variance]')).toHaveAttribute(
      'data-variance',
      'high',
    );
    const flour = within(table).getByText('Flour').closest('tr')!;
    expect(within(flour).getByText('+2%')).toHaveAttribute('data-variance', 'ok');
    const totals = within(table).getByRole('rowheader', { name: 'Total' }).closest('tr')!;
    expect(totals).toHaveTextContent('₹243.34');
    expect(totals).toHaveTextContent('+19.45%');
    expect(screen.getByText('1 item is more than 5% off the recipes.')).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    await waitFor(() =>
      expect(consumptionQueries(fetchMock).at(-1)).toBe('?from=2026-10-01&to=2026-10-28'),
    );
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01' } });
    expect(screen.getByLabelText('From')).toHaveAccessibleDescription(
      expect.stringContaining('Choose a range of up to 366 days'),
    );
    expect(consumptionQueries(fetchMock).at(-1)).toBe('?from=2026-10-01&to=2026-10-28');
  });

  it('refuses a day that is not on the calendar without asking the Hub', async () => {
    const fetchMock = hub();
    renderApp('/inventory/consumption?from=2026-09-31&to=2026-10-28');
    expect(await screen.findByLabelText('From')).toHaveAccessibleDescription(
      expect.stringContaining('Choose a range of up to 366 days'),
    );
    expect(consumptionQueries(fetchMock)).toEqual([]);
  });

  it('is under Reports for the accountant, who has no store-room access', async () => {
    const fetchMock = hub({ 'GET /reports/dashboard': () => json(makeDashboard()) }, [
      'reports.sales',
      'reports.inventory',
    ]);
    renderApp('/reports/consumption');
    const table = await screen.findByRole('table', { name: 'Consumption' });
    expect(within(table).getByText('Basmati rice')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Report sections' }))
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Dashboard', 'Day-end', 'Sales', 'Consumption']);
    // Today comes from the dashboard; the store room's own lists are not asked for.
    expect(consumptionQueries(fetchMock)).toEqual(['?from=2026-10-28&to=2026-10-28']);
    const asked = fetchMock.mock.calls.map(([u]) => new URL(String(u), 'http://hub.test').pathname);
    expect(asked).not.toContain('/api/v1/inventory-items');
    expect(asked).not.toContain('/api/v1/stock/alerts');
  });

  it('is not offered without reports.inventory', async () => {
    hub({ 'GET /reports/dashboard': () => json(makeDashboard()) }, ['reports.sales']);
    renderApp('/reports/consumption');
    expect(await screen.findByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Consumption' })).toBeNull();
  });
});
