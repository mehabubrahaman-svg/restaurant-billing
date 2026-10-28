import { describe, expect, it } from 'vitest';
import { jsonDiff } from './json-diff';

describe('jsonDiff', () => {
  it('lists changed, added and removed fields, including nested ones', () => {
    const rows = jsonDiff(
      { name: 'Asha', roles: ['CASHIER'], contact: { phone: '98' }, pin: true },
      { name: 'Asha Sen', roles: ['CASHIER', 'CAPTAIN'], contact: { phone: '98' } },
    );
    expect(rows).toEqual([
      { path: 'name', before: '"Asha"', after: '"Asha Sen"', kind: 'changed' },
      { path: 'pin', before: 'true', after: undefined, kind: 'removed' },
      { path: 'roles.1', before: undefined, after: '"CAPTAIN"', kind: 'added' },
    ]);
  });

  it('treats a missing side as empty (creates and deletes)', () => {
    expect(jsonDiff(null, { a: 1 })).toEqual([
      { path: 'a', before: undefined, after: '1', kind: 'added' },
    ]);
    expect(jsonDiff({ a: 1 }, null)[0]?.kind).toBe('removed');
  });

  it('is empty when nothing changed', () => {
    expect(jsonDiff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
  });
});
