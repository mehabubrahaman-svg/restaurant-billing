import type { BleMethod } from './schemas';

/**
 * Routes the Hub accepts over the Bluetooth fallback channel (docs/05 §4):
 * enough for captains to keep taking orders and firing KOTs, and for KDS
 * screens to keep bumping tickets, while Wi-Fi is down. Everything else
 * (billing, reports, menu sync, admin) waits for Wi-Fi. Routes that need a
 * manager approver token (cancellations) are deliberately absent because
 * `/auth/approve` is not available over BLE either. The normal JWT and RBAC
 * checks still apply to every allowed route. `:name` matches one path segment.
 */
export const BLE_ALLOWED_ROUTES = [
  { method: 'POST', path: '/auth/refresh' },
  { method: 'GET', path: '/orders' },
  { method: 'POST', path: '/orders' },
  { method: 'GET', path: '/orders/:id' },
  { method: 'POST', path: '/orders/:id/items' },
  { method: 'PATCH', path: '/orders/:id/items/:itemId' },
  { method: 'POST', path: '/orders/:id/kots' },
  { method: 'GET', path: '/kitchen/kots' },
  { method: 'POST', path: '/kitchen/kots/:id/status' },
  { method: 'POST', path: '/kitchen/kots/:id/items/:itemId/ready' },
] as const satisfies readonly { method: BleMethod; path: string }[];

export type BleAllowedRoute = (typeof BLE_ALLOWED_ROUTES)[number];

/** Problem `code` the Hub returns (with HTTP 403) for a route outside the allow-list. */
export const BLE_ROUTE_NOT_ALLOWED = 'BLE_ROUTE_NOT_ALLOWED';

const PARAM_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const LITERAL_SEGMENT = /^[a-z0-9-]+$/;

/**
 * Finds the allow-list entry for a request, or undefined. Strict on purpose:
 * no trailing slash, no empty, `.`/`..` or percent-encoded segments, so the
 * path the Hub routes on is exactly the path that was checked.
 */
export function matchBleRoute(method: string, path: string): BleAllowedRoute | undefined {
  const queryAt = path.indexOf('?');
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  if (!pathname.startsWith('/') || pathname.includes('#')) return undefined;
  const segments = pathname.slice(1).split('/');
  if (segments.some((s) => !LITERAL_SEGMENT.test(s) && !PARAM_SEGMENT.test(s))) return undefined;

  return BLE_ALLOWED_ROUTES.find((route) => {
    if (route.method !== method) return false;
    const pattern = route.path.slice(1).split('/');
    if (pattern.length !== segments.length) return false;
    return pattern.every((p, i) => {
      const segment = segments[i]!;
      return p.startsWith(':') ? PARAM_SEGMENT.test(segment) : p === segment;
    });
  });
}

export function isBleRouteAllowed(method: string, path: string): boolean {
  return matchBleRoute(method, path) !== undefined;
}
