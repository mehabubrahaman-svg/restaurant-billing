import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/endpoints';
import { json, mockHub, problem } from '../../test/mock-hub';
import { makeSession } from '../../test/session';
import { refreshSession, REFRESH_LEAD_MS, RESTORE_RETRY_MS, useAuthStore } from './auth-store';

beforeEach(() => {
  useAuthStore.setState({ status: 'restoring', session: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('auth store', () => {
  it('restores a session from the refresh cookie', async () => {
    const hub = mockHub({ 'POST /auth/refresh': () => json(makeSession()) });
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().session?.accessToken).toBe('access-1');
    expect(hub.mock.calls[0]![1]?.credentials).toBe('include');
  });

  it('becomes anonymous when there is no session', async () => {
    mockHub({ 'POST /auth/refresh': () => problem(401, 'UNAUTHENTICATED') });
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anonymous', session: null });
  });

  it('keeps restoring while the Hub is unreachable at start-up, then signs back in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let up = false;
    mockHub({
      'POST /auth/refresh': () => {
        if (!up) throw new TypeError('Failed to fetch');
        return json(makeSession());
      },
    });
    const restoring = useAuthStore.getState().restore();
    await vi.advanceTimersByTimeAsync(RESTORE_RETRY_MS);
    expect(useAuthStore.getState().status).toBe('restoring');
    up = true;
    await vi.advanceTimersByTimeAsync(RESTORE_RETRY_MS);
    await restoring;
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('never writes the access token to storage', async () => {
    mockHub({ 'POST /auth/refresh': () => json(makeSession({ accessToken: 'secret-token' })) });
    await useAuthStore.getState().restore();
    const stored = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '');
    expect(stored.join('')).not.toContain('secret-token');
  });

  it('shares one refresh between concurrent 401s (single flight)', async () => {
    let issued = 0;
    const hub = mockHub({
      'POST /auth/refresh': async () => {
        await new Promise((r) => setTimeout(r, 10));
        issued += 1;
        return json(makeSession({ accessToken: `fresh-${issued}` }));
      },
      'GET /users': ({ headers }) =>
        headers.get('authorization') === 'Bearer fresh-1'
          ? json({ data: [] })
          : problem(401, 'UNAUTHENTICATED'),
    });
    useAuthStore.setState({
      status: 'authenticated',
      session: makeSession({ accessToken: 'stale' }),
    });
    const results = await Promise.all([api.users.list(), api.users.list(), api.users.list()]);
    expect(results).toEqual([{ data: [] }, { data: [] }, { data: [] }]);
    const refreshes = hub.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
  });

  it('signs out when the refresh itself is refused', async () => {
    mockHub({
      'POST /auth/refresh': () => problem(401, 'UNAUTHENTICATED'),
      'GET /users': () => problem(401, 'UNAUTHENTICATED'),
    });
    useAuthStore.setState({ status: 'authenticated', session: makeSession() });
    await expect(api.users.list()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('keeps the session when the Hub is unreachable during refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    useAuthStore.setState({ status: 'authenticated', session: makeSession() });
    await expect(refreshSession()).resolves.toBe('unreachable');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('refreshes proactively about a minute before expiry', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const hub = mockHub({
      'POST /auth/login': () =>
        json(makeSession({ expiresAt: new Date(now + 15 * 60_000).toISOString() })),
      'POST /auth/refresh': () =>
        json(
          makeSession({
            accessToken: 'renewed',
            expiresAt: new Date(now + 30 * 60_000).toISOString(),
          }),
        ),
    });
    await useAuthStore.getState().login({ username: 'owner', password: 'x' });
    await vi.advanceTimersByTimeAsync(15 * 60_000 - REFRESH_LEAD_MS - 1_000);
    expect(hub.mock.calls.some(([u]) => String(u).endsWith('/auth/refresh'))).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(useAuthStore.getState().session?.accessToken).toBe('renewed');
  });

  it('logout clears the session even if the Hub is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    useAuthStore.setState({ status: 'authenticated', session: makeSession() });
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().session).toBeNull();
  });
});
