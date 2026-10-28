import type { SessionResponse } from '@restroos/contracts';
import { Alert, Card, SegmentedControl, Store } from '@restroos/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api } from '../../api/endpoints';
import { homePath } from '../../app/portals';
import { LanguageSwitcher } from '../../i18n/language-switcher';
import { useErrorMessage } from '../../lib/errors';
import { useDeviceStore } from '../../stores/device-store';
import { ConnectionPill } from '../connection/connection-pill';
import { useAuthStore } from './auth-store';
import { BranchPicker } from './branch-picker';
import { PasswordLogin } from './password-login';
import { PinLogin } from './pin-login';

type Mode = 'pin' | 'password';

/**
 * Shared-device login (wireframes §3): PIN tiles for day-to-day use, or
 * username + password. People with several branches pick one afterwards.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const device = useDeviceStore((s) => s.name);
  const kind = useDeviceStore((s) => s.kind);
  const status = useAuthStore((s) => s.status);
  const { login, pinLogin, switchBranch } = useAuthStore.getState();

  const pinUsers = useQuery({ queryKey: ['auth', 'pin-users'], queryFn: api.auth.pinUsers });
  const [chosenMode, setMode] = useState<Mode | null>(null);
  const mode: Mode =
    chosenMode ?? (pinUsers.isError || pinUsers.data?.data.length === 0 ? 'password' : 'pin');

  // True from submit until we navigate away, so the redirect below does not
  // fire before the branch picker gets a chance to show.
  const [inFlight, setInFlight] = useState(false);
  const [branchChoice, setBranchChoice] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: unknown } | null)?.from;
  const target = (session: Pick<SessionResponse, 'permissions'>) =>
    typeof from === 'string' && from !== '/login' ? from : homePath(session, kind);

  if (status === 'authenticated' && !inFlight && branchChoice === null) {
    const session = useAuthStore.getState().session;
    return <Navigate to={session === null ? '/' : target(session)} replace />;
  }

  async function signIn(attempt: () => Promise<SessionResponse>, onFail?: () => void) {
    setInFlight(true);
    setError(null);
    try {
      const session = await attempt();
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      if (session.branches.length > 1) setBranchChoice(session);
      else void navigate(target(session), { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      onFail?.();
      setInFlight(false);
    }
  }

  async function pickBranch(branchId: string) {
    if (branchChoice !== null && branchId !== branchChoice.branch.id) await switchBranch(branchId);
    const session = useAuthStore.getState().session ?? branchChoice;
    if (session !== null) void navigate(target(session), { replace: true });
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <title>{`${t('login.title')} · ${t('app.name')}`}</title>
      <Card className="flex w-full max-w-md flex-col items-center gap-5 p-6">
        <header className="flex flex-col items-center gap-1 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Store aria-hidden="true" className="size-6" />
          </span>
          <h1 className="text-2xl font-bold">{t('app.name')}</h1>
          <p className="text-muted-foreground">{t('login.device', { name: device, kind })}</p>
          <ConnectionPill className="mt-2" />
        </header>

        {branchChoice !== null ? (
          <BranchPicker
            branches={branchChoice.branches}
            currentId={branchChoice.branch.id}
            onPick={pickBranch}
          />
        ) : (
          <>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <SegmentedControl<Mode>
                aria-label={t('login.method')}
                value={mode}
                onValueChange={(m) => {
                  setMode(m);
                  setError(null);
                }}
                options={[
                  { value: 'pin', label: t('login.withPin') },
                  { value: 'password', label: t('login.withPassword') },
                ]}
              />
              <LanguageSwitcher />
            </div>
            {error !== null && (
              <Alert tone="danger" role="alert" className="w-full">
                {error}
              </Alert>
            )}
            {mode === 'pin' ? (
              <PinLogin
                users={pinUsers.data?.data ?? []}
                loading={pinUsers.isPending}
                busy={inFlight}
                onSubmit={(userId, pin, reset) =>
                  void signIn(() => pinLogin({ userId, pin }), reset)
                }
              />
            ) : (
              <PasswordLogin
                busy={inFlight}
                onSubmit={(username, password) => void signIn(() => login({ username, password }))}
              />
            )}
          </>
        )}
      </Card>
    </main>
  );
}
