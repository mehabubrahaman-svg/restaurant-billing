import { Spinner } from '@restroos/ui';
import { motion } from 'motion/react';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ConnectionPill } from '../../features/connection/connection-pill';
import { FULL_SCREEN_PORTAL_PATH, useDeviceStore } from '../../stores/device-store';
import { useAuthStore } from '../../features/auth/auth-store';
import { NavLinks } from './nav-links';
import { TopBar } from './top-bar';

/**
 * Staff shell (wireframes §2). Phones get a bottom bar, tablets an icon rail,
 * desktops a labelled side nav. KDS and token-display devices get their one
 * portal full screen with only the connection pill.
 */
export function AppShell() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const kind = useDeviceStore((s) => s.kind);
  const status = useAuthStore((s) => s.status);

  // Every staff screen needs a session; remember where the user was going.
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: pathname }} />;
  }

  const devicePath = FULL_SCREEN_PORTAL_PATH[kind];
  if (devicePath !== undefined) {
    // The device's own portal and its sub-pages (e.g. /kitchen/availability).
    if (pathname !== devicePath && !pathname.startsWith(`${devicePath}/`)) {
      return <Navigate to={devicePath} replace />;
    }
    return (
      <div className="relative min-h-dvh">
        <div className="fixed end-3 top-3 z-20">
          <ConnectionPill />
        </div>
        <main id="main" className="min-h-dvh p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg print:hidden bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {t('app.skipToContent')}
      </a>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('nav.label')}
          className="sticky top-16 hidden max-h-[calc(100dvh-4rem)] print:hidden shrink-0 overflow-y-auto border-e bg-surface p-2 md:block md:w-24 lg:w-60"
        >
          <NavLinks variant="side" />
        </nav>
        <motion.main
          key={pathname.split('/')[1]}
          id="main"
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="min-w-0 flex-1 p-4 pb-24 md:p-6 print:p-0"
        >
          <Suspense fallback={<Spinner label={t('common.loading')} />}>
            <Outlet />
          </Suspense>
        </motion.main>
      </div>
      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 bottom-0 z-20 overflow-x-auto print:hidden border-t bg-surface px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <NavLinks variant="bar" />
      </nav>
    </div>
  );
}
