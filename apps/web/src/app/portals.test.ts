import { describe, expect, it } from 'vitest';
import { canOpenPortal, homePath, navPortals, PORTALS } from './portals';

const grants = (...permissions: string[]) => ({ permissions });
const ids = (g: ReturnType<typeof grants> | null) => navPortals(g).map((p) => p.id);

describe('portal navigation', () => {
  it('shows the admin portal for any admin permission', () => {
    expect(ids(grants('users.manage'))).toEqual(['admin']);
    expect(ids(grants('audit.view'))).toEqual(['admin']);
  });

  it('filters by the session permissions, in nav order', () => {
    expect(ids(grants('tables.view', 'billing.create'))).toEqual(['captain', 'pos']);
    expect(ids(grants('kds.view'))).toEqual(['kitchen']);
    expect(ids(null)).toEqual([]);
  });

  it('never lists device screens in the nav, but anyone may open them', () => {
    const tokenDisplay = PORTALS.find((p) => p.id === 'tokenDisplay')!;
    expect(ids(grants('dashboard.view', 'kds.view'))).not.toContain('tokenDisplay');
    expect(canOpenPortal(null, tokenDisplay)).toBe(true);
  });

  it('sends each device and user to the right home', () => {
    const owner = grants('dashboard.view', 'billing.create', 'tables.view');
    expect(homePath(owner, 'POS')).toBe('/pos');
    expect(homePath(owner, 'OWNER')).toBe('/admin');
    expect(homePath(grants('tables.view'), 'POS')).toBe('/captain');
    expect(homePath(grants('tables.view'), 'KDS')).toBe('/kitchen');
    expect(homePath(null, 'POS')).toBe('/login');
  });
});
