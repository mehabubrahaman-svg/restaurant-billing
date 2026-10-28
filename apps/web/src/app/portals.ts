import {
  BookOpen,
  ChartColumn,
  ChefHat,
  CreditCard,
  LayoutDashboard,
  Monitor,
  Package,
  QrCode,
  Truck,
  UtensilsCrossed,
  type LucideIcon,
} from '@restroos/ui';
import { FULL_SCREEN_PORTAL_PATH, type DeviceKind } from '../stores/device-store';
import { hasPermission, type PermissionRequirement } from '../features/auth/permissions';

/** Only the part of a session that decides what a user may open. */
export type Grants = { readonly permissions: readonly string[] } | null;

export type PortalId =
  | 'admin'
  | 'captain'
  | 'kitchen'
  | 'pos'
  | 'inventory'
  | 'purchase'
  | 'accounts'
  | 'reports'
  | 'tokenDisplay'
  | 'qrMenu';

export interface Portal {
  readonly id: PortalId;
  readonly path: string;
  readonly icon: LucideIcon;
  /** Needed (any of) to see the portal in the nav and open it. `null`: device screen. */
  readonly permission: PermissionRequirement | null;
  readonly navKey: `portals.${PortalId}.nav`;
  readonly titleKey: `portals.${PortalId}.title`;
  readonly descriptionKey: `portals.${PortalId}.description`;
}

const portal = (
  id: PortalId,
  path: string,
  icon: LucideIcon,
  permission: PermissionRequirement | null,
): Portal => ({
  id,
  path,
  icon,
  permission,
  navKey: `portals.${id}.nav`,
  titleKey: `portals.${id}.title`,
  descriptionKey: `portals.${id}.description`,
});

/** Any of these opens the admin portal; each admin page checks its own. */
export const ADMIN_PERMISSIONS = [
  'dashboard.view',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'audit.view',
  'menu.manage',
  'floor.manage',
  'backup.manage',
  'customers.view',
  'customers.manage',
] as const;

/** Order here is nav order. */
export const PORTALS: readonly Portal[] = [
  portal('admin', '/admin', LayoutDashboard, ADMIN_PERMISSIONS),
  portal('captain', '/captain', UtensilsCrossed, 'tables.view'),
  // The kitchen's "Out of stock" list is also for people who mark items 86 without a KDS.
  portal('kitchen', '/kitchen', ChefHat, ['kds.view', 'menu.toggle_availability', 'menu.manage']),
  portal('pos', '/pos', CreditCard, 'billing.create'),
  portal('inventory', '/inventory', Package, 'inventory.view'),
  portal('purchase', '/purchase', Truck, 'vendors.view'),
  portal('accounts', '/accounts', BookOpen, 'accounts.view'),
  portal('reports', '/reports', ChartColumn, 'reports.sales'),
  // Device screens: opened by paired TVs and guest phones, never listed in the staff nav.
  portal('tokenDisplay', '/token-display', Monitor, null),
  portal('qrMenu', '/qr/:token', QrCode, null),
];

export function canOpenPortal(grants: Grants, p: Portal): boolean {
  return p.permission === null || hasPermission(grants, p.permission);
}

/** Staff portals this user may open, in nav order. */
export function navPortals(grants: Grants): Portal[] {
  return PORTALS.filter((p) => p.permission !== null && hasPermission(grants, p.permission));
}

/** The portal a device of this kind is mostly used for, when the user may open it. */
const DEVICE_HOME: Partial<Record<DeviceKind, PortalId>> = {
  SERVER: 'admin',
  OWNER: 'admin',
  POS: 'pos',
  CAPTAIN: 'captain',
};

/**
 * Where `/` lands: a full-screen device's own portal; else the device's usual
 * portal if the user may open it; else the user's first portal; else login.
 */
export function homePath(grants: Grants, deviceKind: DeviceKind): string {
  const devicePath = FULL_SCREEN_PORTAL_PATH[deviceKind];
  if (devicePath !== undefined) return devicePath;
  const allowed = navPortals(grants);
  const preferred = allowed.find((p) => p.id === DEVICE_HOME[deviceKind]);
  return (preferred ?? allowed[0])?.path ?? '/login';
}
