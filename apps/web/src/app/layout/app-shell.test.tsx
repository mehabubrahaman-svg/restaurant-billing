import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from '../../features/connection/connection-store';
import { i18n } from '../../i18n';
import { useDeviceStore } from '../../stores/device-store';
import { MOCK_USERS, useSessionStore } from '../../stores/session-store';
import { renderApp } from '../../test/render-app';

const signInAs = (role: string) => {
  const user = MOCK_USERS.find((u) => u.role === role);
  useSessionStore.setState({ user: user ?? null });
};

/** The tablet rail and desktop list are both in the DOM; read one of them. */
const navLinks = () =>
  within(screen.getAllByRole('navigation', { name: 'Portals' })[0]!)
    .getAllByRole('link')
    .map((a) => a.getAttribute('href'));

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
  useDeviceStore.setState({ kind: 'POS' });
  useConnectionStore.setState({ consecutiveFailures: 0, hasConnected: false });
  await i18n.changeLanguage('en-IN');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell', () => {
  it('lists only the portals the user may open', () => {
    signInAs('cashier');
    renderApp('/pos');
    expect(screen.getByRole('heading', { level: 1, name: 'Billing counter' })).toBeInTheDocument();
    expect(navLinks()).toEqual(['/captain', '/pos']);
  });

  it('shows a no-access page for a portal outside the user’s permissions', () => {
    signInAs('captain');
    renderApp('/accounts');
    expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument();
  });

  it('redirects / to the device’s home portal', async () => {
    signInAs('owner');
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/pos'));
  });

  it('runs a KDS full screen, without navigation, locked to the kitchen portal', async () => {
    signInAs('owner');
    useDeviceStore.setState({ kind: 'KDS' });
    const { router } = renderApp('/pos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/kitchen'));
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('sends signed-out users to the login screen', async () => {
    useSessionStore.setState({ user: null });
    const { router } = renderApp('/pos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('shows the connection pill going live once the Hub answers', async () => {
    signInAs('owner');
    renderApp('/pos');
    await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('data-status', 'live'));
    expect(screen.getByRole('status')).toHaveTextContent('Live');
  });

  it('shows offline with the queued count when the browser goes offline', async () => {
    signInAs('owner');
    renderApp('/pos');
    act(() => {
      useConnectionStore.setState({ queuedCount: 3 });
      window.dispatchEvent(new Event('offline'));
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveAttribute('data-status', 'offline'),
    );
    expect(screen.getByRole('status')).toHaveTextContent('3 actions queued');
    act(() => {
      useConnectionStore.setState({ queuedCount: 0 });
      window.dispatchEvent(new Event('online'));
    });
  });

  it('switches language everywhere, including the nav', async () => {
    signInAs('cashier');
    renderApp('/pos');
    await act(() => i18n.changeLanguage('bn-IN'));
    expect(screen.getByRole('heading', { level: 1, name: 'বিলিং কাউন্টার' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('bn-IN');
  });
});
