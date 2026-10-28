import { describe, expect, it } from 'vitest';
import { LOCKOUT } from './credentials';
import { User } from './user';

const at = new Date('2026-10-28T12:00:00Z');
const newUser = () =>
  User.create(
    'u1',
    {
      organizationId: 'o1',
      username: 'ravi',
      fullName: 'Ravi Kumar',
      phone: null,
      email: null,
      preferredLocale: 'bn-IN',
      passwordHash: 'secret-hash',
      pinHash: null,
      branchId: 'b1',
      roleIds: ['r-cashier'],
    },
    at,
  );

describe('User', () => {
  it('locks after repeated failures and unlocks after the lock period', () => {
    const user = newUser();
    for (let i = 0; i < LOCKOUT.maxAttempts - 1; i++) user.recordFailedSignIn(at);
    expect(user.isLocked(at)).toBe(false);
    user.recordFailedSignIn(at);
    expect(user.isLocked(at)).toBe(true);
    expect(() => user.assertCanSignIn(at)).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_LOCKED' }),
    );
    const later = new Date(at.getTime() + LOCKOUT.lockMinutes * 60_000 + 1);
    expect(() => user.assertCanSignIn(later)).not.toThrow();
  });

  it('does not treat sign-ins as edits (no version bump, no event)', () => {
    const user = newUser();
    user.pullEvents();
    const version = user.version;
    user.recordFailedSignIn(at);
    user.recordSignIn(at);
    expect(user.version).toBe(version);
    expect(user.pullEvents()).toEqual([]);
  });

  it('resets the failure count on a successful sign-in', () => {
    const user = newUser();
    user.recordFailedSignIn(at);
    user.recordSignIn(at);
    expect(user.state.failedLogins).toBe(0);
    expect(user.state.lastLoginAt).toEqual(at);
  });

  it('refuses deactivated users', () => {
    const user = newUser();
    user.deactivate(at);
    expect(() => user.assertCanSignIn(at)).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_DISABLED' }),
    );
  });

  it('never puts secrets in events', () => {
    const user = newUser();
    user.changePassword('new-hash', at);
    user.changePin('pin-hash', at);
    const json = JSON.stringify(user.pullEvents());
    expect(json).not.toContain('secret-hash');
    expect(json).not.toContain('new-hash');
    expect(json).not.toContain('pin-hash');
  });

  it('requires at least one role', () => {
    expect(() => newUser().setRoles('b1', [], at)).toThrow(
      expect.objectContaining({ code: 'USER_NEEDS_ROLE' }),
    );
  });
});
