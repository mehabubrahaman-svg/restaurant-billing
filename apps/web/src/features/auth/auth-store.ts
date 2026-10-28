import type { LoginRequest, PinLoginRequest, SessionResponse } from '@restroos/contracts';
import { create } from 'zustand';
import { apiClient, isApiError, NetworkError, type RefreshOutcome } from '../../api/client';
import { api } from '../../api/endpoints';
import { isSupportedLocale } from '../../i18n/config';
import { i18n } from '../../i18n';

/** `restoring`: asking the Hub whether the refresh cookie still holds a session. */
export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous';

/** Renew this long before the 15-minute access token expires. */
export const REFRESH_LEAD_MS = 60_000;
/** After a failed background refresh (Hub unreachable), try again this soon. */
export const REFRESH_RETRY_MS = 15_000;
const MIN_REFRESH_DELAY_MS = 5_000;

interface AuthState {
  readonly status: AuthStatus;
  /** Includes the access token. Memory only: never written to storage. */
  readonly session: SessionResponse | null;
  /** On app start: restore the session from the httpOnly refresh cookie. */
  restore(): Promise<void>;
  login(body: LoginRequest): Promise<SessionResponse>;
  pinLogin(body: PinLoginRequest): Promise<SessionResponse>;
  /** Re-issues the session for another branch the user belongs to. */
  switchBranch(branchId: string): Promise<void>;
  logout(): Promise<void>;
}

/** On start-up, while the Hub can't be reached at all, ask again this often. */
export const RESTORE_RETRY_MS = 5_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<RefreshOutcome> | null = null;
/** The last refresh failed for lack of a network (not a Hub error). */
let lastFailureWasNetwork = false;

function schedule(delayMs: number) {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void refreshSession().then((outcome) => {
      if (outcome === 'unreachable') schedule(REFRESH_RETRY_MS);
    });
  }, delayMs);
}

function applySession(session: SessionResponse) {
  useAuthStore.setState({ status: 'authenticated', session });
  const delay = Date.parse(session.expiresAt) - Date.now() - REFRESH_LEAD_MS;
  schedule(Number.isNaN(delay) ? MIN_REFRESH_DELAY_MS : Math.max(delay, MIN_REFRESH_DELAY_MS));
}

function clearSession() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  useAuthStore.setState({ status: 'anonymous', session: null });
}

/** Signed in by a person (not restored): show the app in their own language. */
function adoptUserLocale(session: SessionResponse) {
  const locale = session.user.preferredLocale;
  if (isSupportedLocale(locale) && locale !== i18n.language) void i18n.changeLanguage(locale);
}

/**
 * Renews the access token from the refresh cookie. Concurrent callers (several
 * requests hitting 401 at once) share one request. A switch of branch always
 * makes its own request.
 * - `invalid`: the Hub said no (401/403); the session is cleared → login.
 * - `unreachable`: network or server trouble; the session is kept, so a Wi-Fi
 *   blip never throws a cashier out mid-bill.
 */
export function refreshSession(branchId?: string): Promise<RefreshOutcome> {
  if (inflight !== null && branchId === undefined) return inflight;
  const attempt: Promise<RefreshOutcome> = (async (): Promise<RefreshOutcome> => {
    lastFailureWasNetwork = false;
    try {
      applySession(await api.auth.refresh(branchId));
      return 'ok';
    } catch (error) {
      if (error instanceof NetworkError) {
        lastFailureWasNetwork = true;
        return 'unreachable';
      }
      if (isApiError(error) && (error.status === 401 || error.status === 403)) {
        clearSession();
        return 'invalid';
      }
      return 'unreachable';
    }
  })().finally(() => {
    if (inflight === attempt) inflight = null;
  });
  if (branchId === undefined) inflight = attempt;
  return attempt;
}

export const useAuthStore = create<AuthState>()(() => ({
  status: 'restoring',
  session: null,
  async restore() {
    let outcome = await refreshSession();
    // A tablet that boots while the Wi-Fi or Hub is down keeps its session (and
    // its offline queue's owner) instead of dropping to the sign-in screen.
    while (outcome === 'unreachable' && lastFailureWasNetwork) {
      await new Promise((resolve) => setTimeout(resolve, RESTORE_RETRY_MS));
      if (useAuthStore.getState().status !== 'restoring') return;
      outcome = await refreshSession();
    }
    if (outcome !== 'ok') clearSession();
  },
  async login(body) {
    const session = await api.auth.login(body);
    applySession(session);
    adoptUserLocale(session);
    return session;
  },
  async pinLogin(body) {
    const session = await api.auth.pinLogin(body);
    applySession(session);
    adoptUserLocale(session);
    return session;
  },
  async switchBranch(branchId) {
    const outcome = await refreshSession(branchId);
    if (outcome === 'unreachable') throw new NetworkError(null);
  },
  async logout() {
    try {
      await api.auth.logout();
    } catch {
      // Already signed out on the Hub, or it is unreachable: forget the session anyway.
    }
    clearSession();
  },
}));

apiClient.connect({
  accessToken: () => useAuthStore.getState().session?.accessToken ?? null,
  refresh: () => refreshSession(),
});

export function useSession(): SessionResponse | null {
  return useAuthStore((s) => s.session);
}
