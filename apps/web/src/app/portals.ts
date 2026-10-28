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
import { hasPermission, type PermissionCode, type SessionUser } from '../stores/session-store';

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
  /** Needed to see the portal in the nav and open it. `null`: device screen, not a staff portal. */
  readonly permission: PermissionCode | null;
  readonly navKey: `portals.${PortalId}.nav`;
  readonly titleKey: `portals.${PortalId}.title`;
  readonly descriptionKey: `portals.${PortalId}.description`;
}

const portal = (
  id: PortalId,
  path: string,
  icon: LucideIcon,
  permission: PermissionCode | null,
): Portal => ({
  id,
  path,
  icon,
  permission,
  navKey: `portals.${id}.nav`,
  titleKey: `portals.${id}.title`,
  descriptionKey: `portals.${id}.description`,
});

/** Order here is nav order. */
export const PORTALS: readonly Portal[] = [
  portal('admin', '/admin', LayoutDashboard, 'dashboard.view'),
  portal('captain', '/captain', UtensilsCrossed, 'tables.view'),
  portal('kitchen', '/kitchen', ChefHat, 'kds.view'),
  portal('pos', '/pos', CreditCard, 'billing.create'),
  portal('inventory', '/inventory', Package, 'inventory.view'),
  portal('purchase', '/purchase', Truck, 'vendors.view'),
  portal('accounts', '/accounts', BookOpen, 'accounts.view'),
  portal('reports', '/reports', ChartColumn, 'reports.sales'),
  // Device screens: opened by paired TVs and guest phones, never listed in the staff nav.
  portal('tokenDisplay', '/token-display', Monitor, null),
  portal('qrMenu', '/qr/:token', QrCode, null),
];

export function canOpenPortal(user: SessionUser | null, p: Portal): boolean {
  return p.permission === null || hasPermission(user, p.permission);
}

/** Staff portals this user may open, in nav order. */
export function navPortals(user: SessionUser | null): Portal[] {
  return PORTALS.filter((p) => p.permission !== null && hasPermission(user, p.permission));
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
export function homePath(user: SessionUser | null, deviceKind: DeviceKind): string {
  const devicePath = FULL_SCREEN_PORTAL_PATH[deviceKind];
  if (devicePath !== undefined) return devicePath;
  const allowed = navPortals(user);
  const preferred = allowed.find((p) => p.id === DEVICE_HOME[deviceKind]);
  return (preferred ?? allowed[0])?.path ?? '/login';
}
