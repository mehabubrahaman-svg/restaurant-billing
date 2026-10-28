import { ShieldAlert } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/login-page';
import { PortalPlaceholder } from '../portals/portal-placeholder';
import { PosPage } from '../portals/pos/pos-page';
import { QrMenuPage } from '../portals/qr-menu/qr-menu-page';
import { AppShell } from './layout/app-shell';
import { RequirePermission } from './layout/require-permission';
import { StatusPage } from './layout/status-page';
import { PORTALS, type Portal } from './portals';
import { RootLayout } from './root-layout';
import { useHomePath } from './use-home-path';

function HomeRedirect() {
  return <Navigate to={useHomePath()} replace />;
}

function NotFoundPage() {
  const { t } = useTranslation();
  return <StatusPage icon={ShieldAlert} title={t('notFound.title')} body={t('notFound.body')} />;
}

function portalElement(portal: Portal) {
  const page =
    portal.id === 'pos' ? <PosPage portal={portal} /> : <PortalPlaceholder portal={portal} />;
  return <RequirePermission portal={portal}>{page}</RequirePermission>;
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      // Guest QR ordering is public and phone-first: no staff shell.
      { path: '/qr/:token', element: <QrMenuPage /> },
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <HomeRedirect /> },
          ...PORTALS.filter((p) => p.id !== 'qrMenu').map((p) => ({
            path: p.path,
            element: portalElement(p),
          })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
