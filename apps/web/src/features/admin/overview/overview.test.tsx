import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { makeAlerts } from '../../../test/inventory-fixtures';
import { BASE_ROUTES, json, mockHub } from '../../../test/mock-hub';
import { renderApp } from '../../../test/render-app';
import { makeDashboard } from '../../../test/report-fixtures';
import { makeSession } from '../../../test/session';
import { useAuthStore } from '../../auth/auth-store';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

const tonight = () => {
  const d = new Date();
  d.setHours(23, 30, 0, 0);
  return d.toISOString();
};

describe('Admin overview', () => {
  it('shows the owner today’s sales, what needs attention, and every section', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () =>
        json(
          makeSession({
            permissions: ['dashboard.view', 'inventory.view', 'tables.view', 'menu.manage'],
          }),
        ),
      'GET /reports/dashboard': () => json(makeDashboard()),
      'GET /stock/alerts': () => json(makeAlerts()),
      'GET /reservations': () =>
        json({
          data: [
            {
              id: 'b0000000-0000-4000-8000-000000000001',
              tableId: null,
              tableLabel: null,
              customerId: null,
              guestName: 'Ananya Das',
              guestPhone: null,
              partySize: 6,
              reservedFor: tonight(),
              status: 'BOOKED',
              notes: null,
              createdAt: tonight(),
              version: 1,
            },
          ],
        }),
    });
    renderApp('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByText('Coming soon')).toBeNull();

    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    const stock = await within(attention).findByRole('heading', { name: 'Stock' });
    expect(stock.closest('div')).toHaveTextContent('1 item out, 1 low');
    expect(within(attention).getByRole('link', { name: 'Stock alerts' })).toHaveAttribute(
      'href',
      '/inventory/alerts',
    );
    expect(await within(attention).findByText('1 booking today, 6 guests')).toBeInTheDocument();
    expect(within(attention).getByText('Next: 11:30 pm, Ananya Das')).toBeInTheDocument();

    // The dashboard: today's sales.
    expect(await screen.findByText('₹1,84,220.00')).toBeInTheDocument();
    // Shortcuts to the sections this user may open.
    const manage = screen.getByRole('heading', { name: 'Manage' }).parentElement!;
    expect(within(manage).getByRole('link', { name: 'Menu' })).toHaveAttribute(
      'href',
      '/admin/menu',
    );
    expect(within(manage).queryByRole('link', { name: 'Staff' })).toBeNull();
  });

  it('takes a captain who opens Admin for the guest list straight to Customers', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () =>
        json(makeSession({ permissions: ['tables.view', 'customers.view', 'customers.manage'] })),
    });
    const { router } = renderApp('/admin');
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/customers'));
    expect(screen.queryByText('Coming soon')).toBeNull();
  });
});
