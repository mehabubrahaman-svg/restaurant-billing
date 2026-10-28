import { ShieldAlert } from '@restroos/ui';
import { lazy, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AdminLayout, CUSTOMER_PERMISSIONS } from '../features/admin/admin-layout';
import type { PermissionRequirement } from '../features/auth/permissions';
import { LoginPage } from '../features/auth/login-page';
import { AvailabilityPage } from '../features/menu/availability-page';
import { CaptainLayout } from '../portals/captain/captain-layout';
import { CaptainPage } from '../portals/captain/captain-page';
import { OrderPadPage } from '../portals/captain/order-pad/order-pad-page';
import { ReservationsPage } from '../portals/captain/reservations-page';
import { AdminOverviewPage } from '../features/admin/overview/overview-page';
import {
  AVAILABILITY_PERMISSIONS,
  KitchenHome,
  KitchenLayout,
} from '../portals/kitchen/kitchen-layout';
import { PortalPlaceholder } from '../portals/portal-placeholder';
import { BillsPage } from '../portals/pos/bills-page';
import { CounterPage } from '../portals/pos/counter-page';
import { DeliveryPage } from '../portals/pos/delivery-page';
import { InvoiceDetailPage } from '../portals/pos/invoice-detail-page';
import { PosLayout } from '../portals/pos/pos-layout';
import { ShiftPage, ShiftReportPage } from '../portals/pos/shift-page';
import { QrMenuPage } from '../portals/qr-menu/qr-menu-page';
import {
  ADJUST_PERMISSION,
  CONSUMPTION_PERMISSION,
  InventoryLayout,
} from '../portals/inventory/inventory-layout';
import { ReportsLayout } from '../portals/reports/reports-layout';
import { TokenDisplayPage } from '../portals/token-display/token-display-page';
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
const CouponsPage = lazy(() =>
  import('../features/admin/coupons/coupons-page').then((m) => ({ default: m.CouponsPage })),
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
const BackupsPage = lazy(() =>
  import('../features/admin/backups/backups-page').then((m) => ({ default: m.BackupsPage })),
);
const SalesChannelsPage = lazy(() =>
  import('../features/admin/sales-channels/sales-channels-page').then((m) => ({
    default: m.SalesChannelsPage,
  })),
);
const CustomersPage = lazy(() =>
  import('../features/admin/customers/customers-page').then((m) => ({ default: m.CustomersPage })),
);
const CustomerDetailPage = lazy(() =>
  import('../features/admin/customers/customers-page').then((m) => ({
    default: m.CustomerDetailPage,
  })),
);
const DashboardPage = lazy(() =>
  import('../portals/reports/dashboard-page').then((m) => ({ default: m.DashboardPage })),
);
const DayEndPage = lazy(() =>
  import('../portals/reports/day-end-page').then((m) => ({ default: m.DayEndPage })),
);
const ItemsPage = lazy(() =>
  import('../portals/inventory/items-page').then((m) => ({ default: m.ItemsPage })),
);
const ItemDetailPage = lazy(() =>
  import('../portals/inventory/item-detail-page').then((m) => ({ default: m.ItemDetailPage })),
);
const StockEntryPage = lazy(() =>
  import('../portals/inventory/stock-entry-page').then((m) => ({ default: m.StockEntryPage })),
);
const CountsPage = lazy(() =>
  import('../portals/inventory/counts-page').then((m) => ({ default: m.CountsPage })),
);
const CountSheetPage = lazy(() =>
  import('../portals/inventory/count-sheet-page').then((m) => ({ default: m.CountSheetPage })),
);
const AlertsPage = lazy(() =>
  import('../portals/inventory/alerts-page').then((m) => ({ default: m.AlertsPage })),
);
const ConsumptionPage = lazy(() =>
  import('../portals/inventory/consumption-page').then((m) => ({ default: m.ConsumptionPage })),
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
    | 'admin.tabs.coupons'
    | 'admin.tabs.printers'
    | 'admin.tabs.menu'
    | 'admin.tabs.floor'
    | 'admin.tabs.devices'
    | 'admin.tabs.audit'
    | 'admin.tabs.backups'
    | 'admin.tabs.channels'
    | 'admin.tabs.customers';
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

/** Portals with their own route trees (the rest get a simple guarded page). */
const OWN_ROUTES: ReadonlySet<Portal['id']> = new Set([
  'qrMenu',
  'admin',
  'captain',
  'kitchen',
  'tokenDisplay',
  'pos',
  'reports',
  'inventory',
]);

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
      { index: true, element: <AdminOverviewPage /> },
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
          ['coupons', 'admin.tabs.coupons', <CouponsPage key="cp" />],
          ['printers', 'admin.tabs.printers', <PrintersPage key="p" />],
          ['sales-channels', 'admin.tabs.channels', <SalesChannelsPage key="sc" />],
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
        path: 'backups',
        element: (
          <AdminGuard permission="backup.manage" labelKey="admin.tabs.backups">
            <BackupsPage />
          </AdminGuard>
        ),
      },
      {
        path: 'customers',
        element: (
          <AdminGuard permission={CUSTOMER_PERMISSIONS} labelKey="admin.tabs.customers">
            <CustomersPage />
          </AdminGuard>
        ),
      },
      {
        path: 'customers/:customerId',
        element: (
          <AdminGuard permission={CUSTOMER_PERMISSIONS} labelKey="admin.tabs.customers">
            <CustomerDetailPage />
          </AdminGuard>
        ),
      },
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

function captainRoutes(): RouteObject {
  const captain = portal('captain');
  return {
    path: 'captain',
    element: (
      <PortalGuard portal={captain}>
        <CaptainLayout />
      </PortalGuard>
    ),
    children: [
      { index: true, element: <CaptainPage portal={captain} /> },
      { path: 'orders/:orderId', element: <OrderPadPage /> },
      { path: 'reservations', element: <ReservationsPage /> },
    ],
  };
}

function posRoutes(): RouteObject {
  const pos = portal('pos');
  return {
    path: 'pos',
    element: (
      <PortalGuard portal={pos}>
        <PosLayout />
      </PortalGuard>
    ),
    children: [
      { index: true, element: <CounterPage /> },
      { path: 'bills', element: <BillsPage /> },
      { path: 'bills/:invoiceId', element: <InvoiceDetailPage /> },
      {
        path: 'delivery',
        element: (
          <DeliveryGuard>
            <DeliveryPage />
          </DeliveryGuard>
        ),
      },
      {
        path: 'shift',
        element: (
          <ShiftGuard>
            <ShiftPage />
          </ShiftGuard>
        ),
      },
      {
        path: 'shift/:shiftId',
        element: (
          <ShiftGuard>
            <ShiftReportPage />
          </ShiftGuard>
        ),
      },
    ],
  };
}

function DeliveryGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <RequirePermission permission="orders.create" name={t('pos.tabs.delivery')}>
      {children}
    </RequirePermission>
  );
}

function reportsRoutes(): RouteObject {
  const reports = portal('reports');
  return {
    path: 'reports',
    element: (
      <PortalGuard portal={reports}>
        <ReportsLayout />
      </PortalGuard>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'day-end', element: <DayEndPage /> },
      {
        path: 'consumption',
        element: (
          <SectionGuard permission={CONSUMPTION_PERMISSION} labelKey="inventory.tabs.consumption">
            <ConsumptionPage />
          </SectionGuard>
        ),
      },
    ],
  };
}

/** Guard for one tab of a portal, named by its label. */
function SectionGuard({
  permission,
  labelKey,
  children,
}: {
  permission: PermissionRequirement;
  labelKey: 'inventory.tabs.stock' | 'inventory.tabs.consumption';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <RequirePermission permission={permission} name={t(labelKey)}>
      {children}
    </RequirePermission>
  );
}

function inventoryRoutes(): RouteObject {
  const inventory = portal('inventory');
  return {
    path: 'inventory',
    element: (
      <PortalGuard portal={inventory}>
        <InventoryLayout />
      </PortalGuard>
    ),
    children: [
      { index: true, element: <ItemsPage /> },
      { path: 'items/:itemId', element: <ItemDetailPage /> },
      {
        path: 'stock',
        element: (
          <SectionGuard permission={ADJUST_PERMISSION} labelKey="inventory.tabs.stock">
            <StockEntryPage />
          </SectionGuard>
        ),
      },
      { path: 'counts', element: <CountsPage /> },
      { path: 'counts/:countId', element: <CountSheetPage /> },
      { path: 'alerts', element: <AlertsPage /> },
      {
        path: 'consumption',
        element: (
          <SectionGuard permission={CONSUMPTION_PERMISSION} labelKey="inventory.tabs.consumption">
            <ConsumptionPage />
          </SectionGuard>
        ),
      },
    ],
  };
}

function ShiftGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <RequirePermission permission="cash.shift_manage" name={t('pos.tabs.shift')}>
      {children}
    </RequirePermission>
  );
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
      // The customer TV: full screen, works on a paired device with nobody signed in.
      { path: '/token-display', element: <TokenDisplayPage /> },
      // Public: a new tablet opens this from the admin's pairing QR.
      { path: '/pair', element: <PairPage /> },
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <HomeRedirect /> },
          adminRoutes(),
          captainRoutes(),
          kitchenRoutes(),
          posRoutes(),
          reportsRoutes(),
          inventoryRoutes(),
          ...PORTALS.filter((p) => !OWN_ROUTES.has(p.id)).map((p) => ({
            path: p.path,
            element: (
              <PortalGuard portal={p}>
                <PortalPlaceholder portal={p} />
              </PortalGuard>
            ),
          })),
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
