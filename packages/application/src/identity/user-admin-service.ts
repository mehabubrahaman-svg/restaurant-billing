import { assertAcceptablePassword, assertAcceptablePin, DomainError, User } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import type {
  IdentityQueries,
  PasswordHasher,
  RefreshTokenStore,
  RoleRepository,
  UserRepository,
} from './ports';

export interface UserAdminDeps {
  readonly users: UserRepository;
  readonly roles: RoleRepository;
  readonly identity: IdentityQueries;
  readonly refreshTokens: RefreshTokenStore;
  readonly hasher: PasswordHasher;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  phone?: string | undefined;
  email?: string | undefined;
  preferredLocale?: string | undefined;
  password: string;
  pin?: string | undefined;
  roleIds: string[];
}

export interface UpdateUserInput {
  version: number;
  fullName?: string | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  preferredLocale?: string | null | undefined;
  roleIds?: string[] | undefined;
}

/** Staff management (permission users.manage). Every change is audited. */
export class UserAdminService {
  constructor(private readonly d: UserAdminDeps) {}

  async create(input: CreateUserInput, ctx: CommandContext): Promise<User> {
    const username = input.username.trim().toLowerCase();
    assertAcceptablePassword(input.password, username);
    if (input.pin) assertAcceptablePin(input.pin);
    const passwordHash = await this.d.hasher.hash(input.password, 'password');
    const pinHash = input.pin ? await this.d.hasher.hash(input.pin, 'pin') : null;

    return this.d.unitOfWork.run(ctx, (scope) => {
      if (this.d.users.findByUsername(username)) {
        throw new DomainError('USERNAME_TAKEN', `username "${username}" is already used`);
      }
      this.assertRolesExist(input.roleIds);
      const organizationId = this.d.identity.organizationId();
      if (!organizationId) throw new DomainError('SETUP_REQUIRED', 'run first-time setup first');
      const user = User.create(
        this.d.ids.next(),
        {
          organizationId,
          username,
          fullName: input.fullName.trim(),
          phone: input.phone ?? null,
          email: input.email ?? null,
          preferredLocale: input.preferredLocale ?? null,
          passwordHash,
          pinHash,
          branchId: ctx.branchId,
          roleIds: input.roleIds,
        },
        this.d.clock.now(),
      );
      this.d.users.insert(user);
      this.commit(scope, user, 'user.create', undefined, this.publicView(user));
      return user;
    });
  }

  update(userId: string, input: UpdateUserInput, ctx: CommandContext): User {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const user = this.load(userId, input.version);
      const before = this.publicView(user);
      const now = this.d.clock.now();
      const profile = Object.fromEntries(
        (['fullName', 'phone', 'email', 'preferredLocale'] as const)
          .filter((k) => input[k] !== undefined)
          .map((k) => [k, input[k]]),
      );
      if (Object.keys(profile).length > 0) user.updateProfile(profile, now);
      if (input.roleIds) {
        this.assertRolesExist(input.roleIds);
        user.setRoles(ctx.branchId, input.roleIds, now);
      }
      this.d.users.save(user);
      this.assertAnAdminRemains();
      this.commit(scope, user, 'user.update', before, this.publicView(user));
      return user;
    });
  }

  deactivate(userId: string, ctx: CommandContext): User {
    if (userId === ctx.actorId)
      throw new DomainError('CANNOT_DEACTIVATE_SELF', 'you cannot deactivate yourself');
    return this.d.unitOfWork.run(ctx, (scope) => {
      const user = this.load(userId);
      user.deactivate(this.d.clock.now());
      this.d.users.save(user);
      this.assertAnAdminRemains();
      this.d.refreshTokens.revokeAllForUser(userId, this.d.clock.now());
      this.commit(scope, user, 'user.deactivate');
      return user;
    });
  }

  reactivate(userId: string, ctx: CommandContext): User {
    return this.mutate(userId, ctx, 'user.reactivate', (u, now) => u.reactivate(now));
  }

  unlock(userId: string, ctx: CommandContext): User {
    return this.mutate(userId, ctx, 'user.unlock', (u, now) => u.unlock(now));
  }

  async resetPassword(userId: string, password: string, ctx: CommandContext): Promise<User> {
    const user = this.load(userId);
    assertAcceptablePassword(password, user.state.username);
    const hash = await this.d.hasher.hash(password, 'password');
    return this.mutate(userId, ctx, 'user.reset_password', (u, now) => {
      u.changePassword(hash, now);
      this.d.refreshTokens.revokeAllForUser(userId, now);
    });
  }

  async resetPin(userId: string, pin: string, ctx: CommandContext): Promise<User> {
    assertAcceptablePin(pin);
    const hash = await this.d.hasher.hash(pin, 'pin');
    return this.mutate(userId, ctx, 'user.reset_pin', (u, now) => u.changePin(hash, now));
  }

  private mutate(
    userId: string,
    ctx: CommandContext,
    action: string,
    change: (user: User, now: Date) => void,
  ): User {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const user = this.load(userId);
      change(user, this.d.clock.now());
      this.d.users.save(user);
      this.commit(scope, user, action);
      return user;
    });
  }

  private commit(
    scope: TransactionScope,
    user: User,
    action: string,
    before?: unknown,
    after?: unknown,
  ) {
    scope.recordEvents(user.pullEvents());
    scope.audit({ action, entityType: 'User', entityId: user.id, before, after });
  }

  private load(userId: string, expectedVersion?: number): User {
    const user = this.d.users.findById(userId);
    if (!user) throw new DomainError('NOT_FOUND', 'user not found');
    if (expectedVersion !== undefined && user.version !== expectedVersion) {
      throw new DomainError(
        'VERSION_CONFLICT',
        'this user was changed by someone else; reload and try again',
      );
    }
    return user;
  }

  private assertRolesExist(roleIds: readonly string[]): void {
    for (const id of roleIds) {
      if (!this.d.roles.findById(id))
        throw new DomainError('ROLE_NOT_FOUND', `role ${id} does not exist`);
    }
  }

  /** The restaurant must never lock itself out of administration. */
  private assertAnAdminRemains(): void {
    if (this.d.identity.activeAdminIds().length === 0) {
      throw new DomainError('LAST_ADMIN', 'at least one active user must keep the Admin role');
    }
  }

  /** What may appear in audit rows: never hashes. */
  private publicView(user: User) {
    const s = user.state;
    return {
      username: s.username,
      fullName: s.fullName,
      phone: s.phone,
      email: s.email,
      preferredLocale: s.preferredLocale,
      isActive: s.isActive,
      roles: Object.fromEntries([...s.roles].map(([b, r]) => [b, [...r]])),
    };
  }
}
