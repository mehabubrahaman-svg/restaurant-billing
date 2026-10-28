import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { chime } from '../../lib/chime';
import { useDeviceStore } from '../../stores/device-store';
import { expectNoAxeViolations } from '../../test/axe';
import { FakeSocket } from '../../test/fake-socket';
import { makeDevice } from '../../test/fixtures';
import { BASE_ROUTES, json, mockHub } from '../../test/mock-hub';
import { envelope, ORDER_ID } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';

vi.mock('../../lib/chime', () => ({
  chime: vi.fn(),
  unlockAudio: vi.fn(async () => false),
  audioReady: () => false,
}));

let board = { businessDate: '2026-10-28', preparing: [41, 42, 44], ready: [38, 39] };

/** A paired token TV: nobody signs in (the refresh cookie is absent). */
function hub() {
  return mockHub({
    ...BASE_ROUTES,
    'GET /devices/me': () => json(makeDevice({ kind: 'TOKEN_DISPLAY', name: 'Counter TV' })),
    'GET /tokens': () => json(board),
  });
}

const list = (name: string) => screen.getByRole('list', { name });

beforeEach(async () => {
  board = { businessDate: '2026-10-28', preparing: [41, 42, 44], ready: [38, 39] };
  useAuthStore.setState({ status: 'restoring', session: null });
  vi.mocked(chime).mockClear();
  await i18n.changeLanguage('en-IN');
});
afterEach(() => {
  vi.unstubAllGlobals();
  useDeviceStore.setState({ kind: 'POS' });
});

describe('Token display', () => {
  it('boots a paired TOKEN_DISPLAY straight to the board, with nobody signed in', async () => {
    hub();
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/token-display'));
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(await screen.findByRole('heading', { name: 'Preparing' })).toBeInTheDocument();
    expect(
      within(list('Preparing'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['41', '42', '44']);
    // Newest ready first.
    expect(
      within(list('Ready'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['39', '38']);
    await expectNoAxeViolations();
  });

  it('moves a token to READY on token.ready, pulsing it with a chime; the socket authenticates with no token', async () => {
    hub();
    renderApp('/token-display');
    await screen.findByRole('heading', { name: 'Ready' });
    await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
    const ws = FakeSocket.last;
    act(() => {
      ws.open();
      ws.receive({ type: 'hello', seq: 3, topics: ['tokens'] });
    });
    expect(ws.sent[0]).toEqual({ type: 'auth', token: null });

    act(() => ws.receive(envelope('token.ready', { tokenNo: 42, orderId: ORDER_ID })));
    const fresh = await within(list('Ready')).findByText('42');
    expect(fresh).toHaveAttribute('data-fresh', 'true');
    expect(fresh.className).toContain('token-fresh');
    expect(within(list('Preparing')).queryByText('42')).toBeNull();
    expect(chime).toHaveBeenCalledWith('token');
  });

  it('picks up tokens from the periodic refetch too (safety net)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      hub();
      renderApp('/token-display');
      await screen.findByRole('heading', { name: 'Ready' });
      board = { ...board, preparing: [44, 45], ready: [38, 39, 41, 42] };
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(await within(list('Preparing')).findByText('45')).toBeInTheDocument();
      expect(within(list('Ready')).getByText('41')).toHaveAttribute('data-fresh', 'true');
      expect(chime).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
