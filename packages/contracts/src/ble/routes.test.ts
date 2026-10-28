import { describe, expect, it } from 'vitest';
import { BLE_ALLOWED_ROUTES, isBleRouteAllowed, matchBleRoute } from './routes';

const id = '0190f3a2-1234-7abc-8def-0123456789ab';

describe('BLE route allow-list', () => {
  it.each([
    ['POST', '/auth/refresh'],
    ['POST', '/orders'],
    ['GET', '/orders?status=OPEN'],
    ['GET', `/orders/${id}`],
    ['POST', `/orders/${id}/items`],
    ['PATCH', `/orders/${id}/items/${id}`],
    ['POST', `/orders/${id}/kots`],
    ['GET', '/kitchen/kots?station=tandoor&status=NEW'],
    ['POST', `/kitchen/kots/${id}/status`],
    ['POST', `/kitchen/kots/${id}/items/${id}/ready`],
  ])('allows %s %s', (method, path) => {
    expect(isBleRouteAllowed(method, path)).toBe(true);
  });

  it.each([
    ['GET', '/menu'], // bulk: cached on the device, never over BLE
    ['POST', '/auth/login'],
    ['POST', '/auth/approve'],
    ['POST', `/orders/${id}/cancel`],
    ['POST', `/orders/${id}/invoice`],
    ['GET', '/reports/day-end'],
    ['DELETE', `/orders/${id}`],
    ['GET', '/orders/'], // trailing slash
    ['GET', `/orders/${id}/`],
    ['GET', '/orders/../users'],
    ['GET', '/orders/%2e%2e'],
    ['GET', '//orders'],
    ['GET', 'orders'],
    ['GET', '/orders#x'],
    ['GET', `/orders/${'a'.repeat(65)}`],
    ['get', '/orders'],
  ])('refuses %s %s', (method, path) => {
    expect(isBleRouteAllowed(method, path)).toBe(false);
  });

  it('returns the matched pattern', () => {
    expect(matchBleRoute('POST', `/orders/${id}/kots`)).toEqual({
      method: 'POST',
      path: '/orders/:id/kots',
    });
  });

  it('has no duplicate entries', () => {
    const keys = BLE_ALLOWED_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
