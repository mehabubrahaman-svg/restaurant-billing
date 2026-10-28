import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { useConnectionStore } from '../../features/connection/connection-store';
import { i18n } from '../../i18n';
import { useDeviceStore } from '../../stores/device-store';
import { BASE_ROUTES, json, mockHub } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

/** Restore succeeds with a session holding exactly these permissions. */
function hubWithSession(permissions: string[]) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
  });
}

const navLinks = () =>
  within(screen.getAllByRole('navigation', { name: 'Portals' })[0]!)
    .getAllByRole('link')
    .map((a) => a.getAttribute('href'));

beforeEach(async () => {
  useDeviceStore.setState({ kind: 'POS' });
  useAuthStore.setState({ status: 'restoring', session: null });
  useConnectionStore.setState({ consecutiveFailures: 0, hasConnected: false, queuedCount: 0 });
  await i18n.changeLanguage('en-IN');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell', () => {
  it('restores the session on start and lists only permitted portals', async () => {
    hubWithSession(['tables.view', 'billing.create']);
    renderApp('/pos');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Billing counter' }),
    ).toBeInTheDocument();
    expect(navLinks()).toEqual(['/captain', '/pos']);
  });

  it('shows a no-access page for a portal outside the user’s permissions', async () => {
    hubWithSession(['tables.view']);
    renderApp('/accounts');
    expect(await screen.findByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
  });

  it('guards admin sections separately', async () => {
    hubWithSession(['audit.view']);
    renderApp('/admin/users');
    expect(await screen.findByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
    const tabs = within(screen.getByRole('navigation', { name: 'Admin sections' }));
    expect(tabs.getAllByRole('link').map((a) => a.textContent)).toEqual(['Audit log']);
  });

  it('sends signed-out users to the login screen', async () => {
    mockHub(BASE_ROUTES);
    const { router } = renderApp('/pos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('sends an un-set-up Hub to the setup wizard first', async () => {
    mockHub({ ...BASE_ROUTES, 'GET /setup/status': () => json({ needsSetup: true, states: [] }) });
    const { router } = renderApp('/pos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/setup'));
  });

  it('runs a KDS full screen, without navigation', async () => {
    hubWithSession(['kds.view']);
    useDeviceStore.setState({ kind: 'KDS' });
    const { router } = renderApp('/pos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/kitchen'));
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('shows offline with the queued count when the browser goes offline', async () => {
    hubWithSession(['billing.create']);
    renderApp('/pos');
    await screen.findByRole('heading', { level: 1, name: 'Billing counter' });
    act(() => {
      useConnectionStore.setState({ queuedCount: 3 });
      window.dispatchEvent(new Event('offline'));
    });
    const pill = screen.getAllByRole('status').find((el) => el.hasAttribute('data-status'))!;
    await waitFor(() => expect(pill).toHaveAttribute('data-status', 'offline'));
    expect(pill).toHaveTextContent('3 actions queued');
    act(() => window.dispatchEvent(new Event('online')));
  });

  it('switches language everywhere', async () => {
    hubWithSession(['billing.create']);
    renderApp('/pos');
    await screen.findByRole('heading', { level: 1, name: 'Billing counter' });
    await act(() => i18n.changeLanguage('bn-IN'));
    expect(screen.getByRole('heading', { level: 1, name: 'বিলিং কাউন্টার' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('bn-IN');
  });
});
