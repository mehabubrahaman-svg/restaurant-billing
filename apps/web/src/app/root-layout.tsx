import { Button, Spinner, Store } from '@restroos/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { api } from '../api/endpoints';
import { ApprovalDialog } from '../features/approval/approval-dialog';
import { useAuthStore } from '../features/auth/auth-store';
import { RestoreOverlay } from '../features/backups/restore-overlay';
import { useConnectionMonitor } from '../features/connection/use-connection-monitor';
import { useLiveConnection } from '../features/live/use-live-connection';
import { startCommandQueue } from '../features/offline/command-queue';
import { applyTheme, effectiveTheme, useThemeStore } from '../features/theme/theme-store';
import { Toaster } from '../features/toast/toaster';
import { useDevicePrintAgent } from '../features/devices/device-print-agent';
import { DEVICE_ME_KEY, fetchThisDevice } from '../features/devices/this-device';
import { useDeviceStore } from '../stores/device-store';

export const SETUP_STATUS_KEY = ['setup', 'status'] as const;
/** While the Hub can't be reached at start-up, ask again this often. */
export const BOOT_RETRY_MS = 5_000;

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Store aria-hidden="true" className="size-7" />
        </span>
        {children}
      </div>
    </main>
  );
}

/**
 * Wraps the staff app: connection polling, the live WebSocket, the offline
 * command queue, theme, approval dialog, toasts, and
 * the start-up order: (1) an un-set-up Hub goes to /setup; (2) the session is
 * restored from the refresh cookie; (3) only then do routes render.
 */
export function RootLayout() {
  // Outside the start-up gates: a restore's wait must survive the Hub being away.
  return (
    <>
      <RootGates />
      <RestoreOverlay />
    </>
  );
}

function RootGates() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  useConnectionMonitor();
  useLiveConnection();
  // The Android app prints this tablet's Bluetooth tickets, whatever screen is open.
  useDevicePrintAgent();
  const queryClient = useQueryClient();
  // Commands queued offline (captain tablets) replay from here, whatever screen is open.
  useEffect(() => startCommandQueue(queryClient), [queryClient]);
  const preference = useThemeStore((s) => s.preference);
  const kind = useDeviceStore((s) => s.kind);
  const authStatus = useAuthStore((s) => s.status);

  useEffect(() => {
    applyTheme(effectiveTheme(preference, kind));
  }, [preference, kind]);

  // Concurrent calls (StrictMode runs effects twice) share one refresh request.
  useEffect(() => {
    void useAuthStore.getState().restore();
  }, []);

  const device = useQuery({
    queryKey: DEVICE_ME_KEY,
    queryFn: fetchThisDevice,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const setup = useQuery({
    queryKey: SETUP_STATUS_KEY,
    queryFn: api.setup.status,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
    // A tablet that starts while the Hub is unreachable keeps trying on its own
    // (its offline queue replays as soon as the Hub answers), not only on "Try again".
    refetchInterval: (query) => (query.state.status === 'error' ? BOOT_RETRY_MS : false),
  });

  if (setup.isError) {
    return (
      <Splash>
        <h1 className="text-xl font-bold">{t('boot.hubUnreachableTitle')}</h1>
        <p className="text-muted-foreground">{t('boot.hubUnreachableBody')}</p>
        <Button onClick={() => void setup.refetch()} disabled={setup.isFetching}>
          {t('common.retry')}
        </Button>
      </Splash>
    );
  }
  if (
    setup.isPending ||
    device.isPending ||
    (authStatus === 'restoring' && !setup.data.needsSetup)
  ) {
    return (
      <Splash>
        <Spinner label={t('boot.starting')} />
      </Splash>
    );
  }
  if (setup.data.needsSetup && pathname !== '/setup') return <Navigate to="/setup" replace />;
  if (!setup.data.needsSetup && pathname === '/setup') return <Navigate to="/login" replace />;

  return (
    <>
      <Suspense
        fallback={
          <Splash>
            <Spinner label={t('common.loading')} />
          </Splash>
        }
      >
        <Outlet />
      </Suspense>
      <ApprovalDialog />
      <Toaster />
    </>
  );
}
