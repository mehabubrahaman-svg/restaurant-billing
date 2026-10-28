import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ConnectionPill } from '../../features/connection/connection-pill';
import { FULL_SCREEN_PORTAL_PATH, useDeviceStore } from '../../stores/device-store';
import { useSessionStore } from '../../stores/session-store';
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
  const user = useSessionStore((s) => s.user);

  const devicePath = FULL_SCREEN_PORTAL_PATH[kind];
  if (devicePath !== undefined) {
    if (pathname !== devicePath) return <Navigate to={devicePath} replace />;
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

  if (user === null) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {t('app.skipToContent')}
      </a>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('nav.label')}
          className="sticky top-16 hidden max-h-[calc(100dvh-4rem)] shrink-0 overflow-y-auto border-e bg-surface p-2 md:block md:w-24 lg:w-60"
        >
          <NavLinks variant="side" />
        </nav>
        <motion.main
          key={pathname}
          id="main"
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="min-w-0 flex-1 p-4 pb-24 md:p-6"
        >
          <Outlet />
        </motion.main>
      </div>
      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 bottom-0 z-20 overflow-x-auto border-t bg-surface px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <NavLinks variant="bar" />
      </nav>
    </div>
  );
}
