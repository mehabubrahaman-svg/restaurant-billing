import { describe, expect, it } from 'vitest';
import { MOCK_USERS, type SessionUser } from '../stores/session-store';
import { canOpenPortal, homePath, navPortals, PORTALS } from './portals';

const user = (role: SessionUser['role']): SessionUser => {
  const found = MOCK_USERS.find((u) => u.role === role);
  if (found === undefined) throw new Error(role);
  return found;
};

const ids = (u: SessionUser | null) => navPortals(u).map((p) => p.id);

describe('portal navigation', () => {
  it('shows the owner every staff portal and no device screens', () => {
    expect(ids(user('owner'))).toEqual([
      'admin',
      'captain',
      'kitchen',
      'pos',
      'inventory',
      'purchase',
      'accounts',
      'reports',
    ]);
  });

  it('filters by permission', () => {
    expect(ids(user('cashier'))).toEqual(['captain', 'pos']);
    expect(ids(user('captain'))).toEqual(['captain']);
    expect(ids(user('chef'))).toEqual(['kitchen']);
    expect(ids(null)).toEqual([]);
  });

  it('lets anyone open device screens but guards staff portals', () => {
    const tokenDisplay = PORTALS.find((p) => p.id === 'tokenDisplay')!;
    const accounts = PORTALS.find((p) => p.id === 'accounts')!;
    expect(canOpenPortal(null, tokenDisplay)).toBe(true);
    expect(canOpenPortal(user('cashier'), accounts)).toBe(false);
  });

  it('sends each device and user to the right home', () => {
    expect(homePath(user('owner'), 'POS')).toBe('/pos');
    expect(homePath(user('owner'), 'OWNER')).toBe('/admin');
    expect(homePath(user('cashier'), 'POS')).toBe('/pos');
    expect(homePath(user('cashier'), 'OWNER')).toBe('/captain');
    expect(homePath(user('captain'), 'POS')).toBe('/captain');
    expect(homePath(user('chef'), 'CAPTAIN')).toBe('/kitchen');
    expect(homePath(user('cashier'), 'KDS')).toBe('/kitchen');
    expect(homePath(null, 'TOKEN_DISPLAY')).toBe('/token-display');
    expect(homePath(null, 'POS')).toBe('/login');
  });
});
