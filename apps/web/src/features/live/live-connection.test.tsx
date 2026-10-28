import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { makeFloor, makeTable } from '../../test/catalog-fixtures';
import { FakeSocket } from '../../test/fake-socket';
import { BASE_ROUTES, json, mockHub } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';
import { useConnectionStore } from '../connection/connection-store';

let refreshes = 0;

function hub() {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => {
      refreshes += 1;
      return json(
        makeSession({ accessToken: `access-${refreshes}`, permissions: ['tables.view'] }),
      );
    },
    'GET /floor': () => json(makeFloor([makeTable()])),
    'GET /orders': () => json({ data: [] }),
  });
}

const floorFetches = (fetchMock: ReturnType<typeof mockHub>) =>
  fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/api/v1/floor')).length;
const auths = () => FakeSocket.last.sent.filter((m) => m.type === 'auth');
const pill = () => screen.getAllByRole('status').find((el) => el.hasAttribute('data-status'))!;

beforeEach(async () => {
  refreshes = 0;
  useAuthStore.setState({ status: 'restoring', session: null });
  useConnectionStore.setState({ consecutiveFailures: 0, hasConnected: false, live: 'idle' });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Live connection', () => {
  it('opens one socket for the app and re-sends auth after every token refresh', async () => {
    hub();
    renderApp('/captain');
    await screen.findByRole('button', { name: 'Table T1, 4 seats, Free' });
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => {
      FakeSocket.last.open();
      FakeSocket.last.receive({ type: 'hello', seq: 1, topics: ['floor'] });
    });
    expect(auths()).toEqual([{ type: 'auth', token: 'access-1' }]);

    // The auth store renews the token (as its timer does before expiry).
    await act(() => useAuthStore.getState().switchBranch(makeSession().branch.id));
    expect(auths().at(-1)).toEqual({ type: 'auth', token: 'access-2' });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('renews the token when the Hub says `unauthenticated`', async () => {
    hub();
    renderApp('/captain');
    await screen.findByRole('button', { name: 'Table T1, 4 seats, Free' });
    act(() => {
      FakeSocket.last.open();
      FakeSocket.last.receive({ type: 'hello', seq: 1, topics: ['floor'] });
      FakeSocket.last.receive({ type: 'unauthenticated' });
    });
    await waitFor(() => expect(auths().at(-1)).toEqual({ type: 'auth', token: 'access-2' }));
  });

  it('refetches what the screen shows on `resync`', async () => {
    const fetchMock = hub();
    renderApp('/captain');
    await screen.findByRole('button', { name: 'Table T1, 4 seats, Free' });
    const before = floorFetches(fetchMock);
    act(() => {
      FakeSocket.last.open();
      FakeSocket.last.receive({ type: 'hello', seq: 1, topics: ['floor'] });
      FakeSocket.last.receive({ type: 'resync', seq: 5000, reason: 'gap' });
    });
    await waitFor(() => expect(floorFetches(fetchMock)).toBe(before + 1));
  });

  it('shows "Reconnecting" in the pill while the socket is down, and resumes on reconnect', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      hub();
      renderApp('/captain');
      await screen.findByRole('button', { name: 'Table T1, 4 seats, Free' });
      act(() => {
        FakeSocket.last.open();
        FakeSocket.last.receive({ type: 'hello', seq: 10, topics: ['floor'] });
      });
      await waitFor(() => expect(pill()).toHaveAttribute('data-status', 'live'));
      act(() => FakeSocket.last.drop());
      await waitFor(() => expect(pill()).toHaveAttribute('data-status', 'reconnecting'));

      await act(() => vi.advanceTimersByTimeAsync(1_500));
      expect(FakeSocket.instances).toHaveLength(2);
      act(() => {
        FakeSocket.last.open();
        FakeSocket.last.receive({ type: 'hello', seq: 12, topics: ['floor'] });
      });
      expect(FakeSocket.last.sent).toEqual([
        { type: 'auth', token: 'access-1' },
        { type: 'resume', lastSeq: 10 },
      ]);
      await waitFor(() => expect(pill()).toHaveAttribute('data-status', 'live'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the socket on sign-out', async () => {
    hub();
    renderApp('/captain');
    await screen.findByRole('button', { name: 'Table T1, 4 seats, Free' });
    const socket = FakeSocket.last;
    await act(() => useAuthStore.getState().logout());
    expect(socket.closedByApp).toBe(true);
  });
});
