import { ShieldAlert } from '@restroos/ui';
import { lazy, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AdminLayout } from '../features/admin/admin-layout';
import type { PermissionRequirement } from '../features/auth/permissions';
import { LoginPage } from '../features/auth/login-page';
import { AvailabilityPage } from '../features/menu/availability-page';
import { CaptainPage } from '../portals/captain/captain-page';
import {
  AVAILABILITY_PERMISSIONS,
  KitchenHome,
  KitchenLayout,
} from '../portals/kitchen/kitchen-layout';
import { PortalPlaceholder } from '../portals/portal-placeholder';
import { PosPage } from '../portals/pos/pos-page';
import { QrMenuPage } from '../portals/qr-menu/qr-menu-page';
import { AppShell } from './layout/app-shell';
import { RequirePermission } from './layout/require-permission';
import { StatusPage } from './layout/status-page';
import { PORTALS, type Portal } from './portals';
import { RootLayout } from './root-layout';
import { useHomePath } from './use-home-path';

// Admin screens and the one-off setup wizard load on demand; the till screens stay in the main bundle.
const AccountPage = lazy(() =>
  import('../features/account/account-page').then((m) => ({ default: m.AccountPage })),
);
const AuditPage = lazy(() =>
  import('../features/admin/audit/audit-page').then((m) => ({ default: m.AuditPage })),
);
const BranchSettingsPage = lazy(() =>
  import('../features/admin/branch/branch-settings-page').then((m) => ({
    default: m.BranchSettingsPage,
  })),
);
const ChargesPage = lazy(() =>
  import('../features/admin/charges/charges-page').then((m) => ({ default: m.ChargesPage })),
);
const PrintersPage = lazy(() =>
  import('../features/admin/printers/printers-page').then((m) => ({ default: m.PrintersPage })),
);
const RoleEditorPage = lazy(() =>
  import('../features/admin/roles/role-editor-page').then((m) => ({ default: m.RoleEditorPage })),
);
const RolesPage = lazy(() =>
  import('../features/admin/roles/roles-page').then((m) => ({ default: m.RolesPage })),
);
const TaxesPage = lazy(() =>
  import('../features/admin/taxes/taxes-page').then((m) => ({ default: m.TaxesPage })),
);
const UsersPage = lazy(() =>
  import('../features/admin/users/users-page').then((m) => ({ default: m.UsersPage })),
);
const MenuLayout = lazy(() =>
  import('../features/menu/menu-layout').then((m) => ({ default: m.MenuLayout })),
);
const MenuPage = lazy(() =>
  import('../features/menu/menu-page').then((m) => ({ default: m.MenuPage })),
);
const ItemEditorPage = lazy(() =>
  import('../features/menu/item-editor-page').then((m) => ({ default: m.ItemEditorPage })),
);
const AddonGroupsPage = lazy(() =>
  import('../features/menu/addon-groups-page').then((m) => ({ default: m.AddonGroupsPage })),
);
const StationsPage = lazy(() =>
  import('../features/menu/stations-page').then((m) => ({ default: m.StationsPage })),
);
const ImportPage = lazy(() =>
  import('../features/menu/import-page').then((m) => ({ default: m.ImportPage })),
);
const FloorEditorPage = lazy(() =>
  import('../features/floor/floor-editor-page').then((m) => ({ default: m.FloorEditorPage })),
);
const QrPrintPage = lazy(() =>
  import('../features/floor/qr-print-page').then((m) => ({ default: m.QrPrintPage })),
);
const DevicesPage = lazy(() =>
  import('../features/devices/devices-page').then((m) => ({ default: m.DevicesPage })),
);
const PairPage = lazy(() =>
  import('../features/devices/pair-page').then((m) => ({ default: m.PairPage })),
);
const SetupWizard = lazy(() =>
  import('../features/setup/setup-wizard').then((m) => ({ default: m.SetupWizard })),
);

function HomeRedirect() {
  return <Navigate to={useHomePath()} replace />;
}

function NotFoundPage() {
  const { t } = useTranslation();
  return <StatusPage icon={ShieldAlert} title={t('notFound.title')} body={t('notFound.body')} />;
}

function PortalGuard({ portal, children }: { portal: Portal; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <RequirePermission permission={portal.permission} name={t(portal.titleKey)}>
      {children}
    </RequirePermission>
  );
}

/** Guard for one admin section, named by its tab label. */
function AdminGuard({
  permission,
  labelKey,
  children,
}: {
  permission: PermissionRequirement;
  labelKey:
    | 'admin.tabs.users'
    | 'admin.tabs.roles'
    | 'admin.tabs.branch'
    | 'admin.tabs.taxes'
    | 'admin.tabs.charges'
    | 'admin.tabs.printers'
    | 'admin.tabs.menu'
    | 'admin.tabs.floor'
    | 'admin.tabs.devices'
    | 'admin.tabs.audit';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <RequirePermission permission={permission} name={t(labelKey)}>
      {children}
    </RequirePermission>
  );
}

const portal = (id: Portal['id']) => PORTALS.find((p) => p.id === id)!;

function adminRoutes(): RouteObject {
  const admin = portal('admin');
  return {
    path: 'admin',
    element: (
      <PortalGuard portal={admin}>
        <AdminLayout />
      </PortalGuard>
    ),
    children: [
      { index: true, element: <PortalPlaceholder portal={admin} /> },
      {
        path: 'users',
        element: (
          <AdminGuard permission="users.manage" labelKey="admin.tabs.users">
            <UsersPage />
          </AdminGuard>
        ),
      },
      {
        path: 'roles',
        element: (
          <AdminGuard permission={['roles.manage', 'users.manage']} labelKey="admin.tabs.roles">
            <RolesPage />
          </AdminGuard>
        ),
      },
      {
        path: 'roles/new',
        element: (
          <AdminGuard permission="roles.manage" labelKey="admin.tabs.roles">
            <RoleEditorPage />
          </AdminGuard>
        ),
      },
      {
        path: 'roles/:roleId',
        element: (
          <AdminGuard permission={['roles.manage', 'users.manage']} labelKey="admin.tabs.roles">
            <RoleEditorPage />
          </AdminGuard>
        ),
      },
      {
        path: 'menu',
        element: (
          <AdminGuard permission="menu.manage" labelKey="admin.tabs.menu">
            <MenuLayout />
          </AdminGuard>
        ),
        children: [
          { index: true, element: <MenuPage /> },
          { path: 'items/new', element: <ItemEditorPage /> },
          { path: 'items/:itemId', element: <ItemEditorPage /> },
          { path: 'addons', element: <AddonGroupsPage /> },
          { path: 'stations', element: <StationsPage /> },
          { path: 'import', element: <ImportPage /> },
        ],
      },
      {
        path: 'floor',
        element: (
          <AdminGuard permission="floor.manage" labelKey="admin.tabs.floor">
            <FloorEditorPage />
          </AdminGuard>
        ),
      },
      {
        path: 'floor/print',
        element: (
          <AdminGuard permission="floor.manage" labelKey="admin.tabs.floor">
            <QrPrintPage />
          </AdminGuard>
        ),
      },
      ...(
        [
          ['devices', 'admin.tabs.devices', <DevicesPage key="d" />],
          ['branch', 'admin.tabs.branch', <BranchSettingsPage key="b" />],
          ['taxes', 'admin.tabs.taxes', <TaxesPage key="t" />],
          ['charges', 'admin.tabs.charges', <ChargesPage key="c" />],
          ['printers', 'admin.tabs.printers', <PrintersPage key="p" />],
        ] as const
      ).map(([path, labelKey, page]) => ({
        path,
        element: (
          <AdminGuard permission="settings.manage" labelKey={labelKey}>
            {page}
          </AdminGuard>
        ),
      })),
      {
        path: 'audit',
        element: (
          <AdminGuard permission="audit.view" labelKey="admin.tabs.audit">
            <AuditPage />
          </AdminGuard>
        ),
      },
    ],
  };
}

function kitchenRoutes(): RouteObject {
  const kitchen = portal('kitchen');
  return {
    path: 'kitchen',
    element: (
      <PortalGuard portal={kitchen}>
        <KitchenLayout />
      </PortalGuard>
    ),
    children: [
      { index: true, element: <KitchenHome portal={kitchen} /> },
      {
        path: 'availability',
        element: (
          <AvailabilityGuard>
            <AvailabilityPage />
          </AvailabilityGuard>
        ),
      },
    ],
  };
}

function AvailabilityGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <RequirePermission permission={AVAILABILITY_PERMISSIONS} name={t('availability.title')}>
      {children}
    </RequirePermission>
  );
}

export const routes: RouteObject[] = [
  // Guest QR ordering is public and phone-first: no setup gate, no staff shell.
  { path: '/qr/:token', element: <QrMenuPage /> },
  {
    element: <RootLayout />,
    children: [
      { path: '/setup', element: <SetupWizard /> },
      { path: '/login', element: <LoginPage /> },
      // Public: a new tablet opens this from the admin's pairing QR.
      { path: '/pair', element: <PairPage /> },
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <HomeRedirect /> },
          adminRoutes(),
          kitchenRoutes(),
          ...PORTALS.filter((p) => p.id !== 'qrMenu' && p.id !== 'admin' && p.id !== 'kitchen').map(
            (p) => ({
              path: p.path,
              element: (
                <PortalGuard portal={p}>
                  {p.id === 'pos' ? (
                    <PosPage portal={p} />
                  ) : p.id === 'captain' ? (
                    <CaptainPage portal={p} />
                  ) : (
                    <PortalPlaceholder portal={p} />
                  )}
                </PortalGuard>
              ),
            }),
          ),
          { path: 'account', element: <AccountPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
