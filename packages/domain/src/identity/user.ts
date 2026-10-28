import { AggregateRoot } from '../shared/aggregate-root';
import { DomainError } from '../shared/result';
import { LOCKOUT } from './credentials';

export interface UserState {
  organizationId: string;
  username: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  preferredLocale: string | null;
  passwordHash: string;
  pinHash: string | null;
  isActive: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  /** branchId → roleIds */
  roles: Map<string, Set<string>>;
}

/**
 * A staff member. Event payloads never contain password or PIN hashes: events
 * are synced to the cloud and kept forever.
 */
export class User extends AggregateRoot {
  readonly aggregateType = 'User';

  private constructor(
    id: string,
    version: number,
    private readonly s: UserState,
  ) {
    super(id, version);
  }

  static restore(id: string, version: number, state: UserState): User {
    return new User(id, version, state);
  }

  static create(
    id: string,
    input: Omit<
      UserState,
      'isActive' | 'failedLogins' | 'lockedUntil' | 'lastLoginAt' | 'roles'
    > & {
      branchId: string;
      roleIds: readonly string[];
    },
    at: Date,
  ): User {
    if (input.roleIds.length === 0)
      throw new DomainError('USER_NEEDS_ROLE', 'a user needs at least one role');
    const { branchId, roleIds, ...rest } = input;
    const user = new User(id, 0, {
      ...rest,
      isActive: true,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: null,
      roles: new Map([[branchId, new Set(roleIds)]]),
    });
    user.raise(
      'UserCreated',
      { username: rest.username, fullName: rest.fullName, branchId, roleIds: [...roleIds] },
      at,
    );
    return user;
  }

  get state(): Readonly<UserState> {
    return this.s;
  }

  isLocked(now: Date): boolean {
    return this.s.lockedUntil !== null && this.s.lockedUntil > now;
  }

  /** Throws if this user may not sign in right now. Call before checking the secret. */
  assertCanSignIn(now: Date): void {
    if (!this.s.isActive) throw new DomainError('ACCOUNT_DISABLED', 'this account is deactivated');
    if (this.isLocked(now)) {
      throw new DomainError('ACCOUNT_LOCKED', `locked until ${this.s.lockedUntil!.toISOString()}`, {
        lockedUntil: this.s.lockedUntil!.toISOString(),
      });
    }
  }

  /*
   * Sign-in bookkeeping is not an edit of the user: it doesn't bump the
   * version (an admin editing a profile must not get a conflict because the
   * person just logged in) and raises no event. Sign-ins are recorded in the
   * audit log instead.
   */

  /** Returns true when this failure locked the account. */
  recordFailedSignIn(at: Date): boolean {
    this.s.failedLogins += 1;
    if (this.s.failedLogins < LOCKOUT.maxAttempts) return false;
    this.s.lockedUntil = new Date(at.getTime() + LOCKOUT.lockMinutes * 60_000);
    this.s.failedLogins = 0;
    return true;
  }

  recordSignIn(at: Date): void {
    this.s.failedLogins = 0;
    this.s.lockedUntil = null;
    this.s.lastLoginAt = at;
  }

  updateProfile(
    changes: Partial<Pick<UserState, 'fullName' | 'phone' | 'email' | 'preferredLocale'>>,
    at: Date,
  ): void {
    Object.assign(this.s, changes);
    this.raise('UserProfileUpdated', { ...changes }, at);
  }

  setRoles(branchId: string, roleIds: readonly string[], at: Date): void {
    if (roleIds.length === 0)
      throw new DomainError('USER_NEEDS_ROLE', 'a user needs at least one role');
    this.s.roles.set(branchId, new Set(roleIds));
    this.raise('UserRolesChanged', { branchId, roleIds: [...roleIds] }, at);
  }

  changePassword(passwordHash: string, at: Date): void {
    this.s.passwordHash = passwordHash;
    this.raise('UserPasswordChanged', {}, at);
  }

  changePin(pinHash: string, at: Date): void {
    this.s.pinHash = pinHash;
    this.raise('UserPinChanged', {}, at);
  }

  deactivate(at: Date): void {
    if (!this.s.isActive) return;
    this.s.isActive = false;
    this.raise('UserDeactivated', {}, at);
  }

  reactivate(at: Date): void {
    if (this.s.isActive) return;
    this.s.isActive = true;
    this.raise('UserReactivated', {}, at);
  }

  unlock(at: Date): void {
    this.s.lockedUntil = null;
    this.s.failedLogins = 0;
    this.raise('UserUnlocked', {}, at);
  }
}
