import { assertAcceptablePassword, DomainError, type User } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type {
  BranchSummary,
  IdentityQueries,
  PasswordHasher,
  RefreshTokenStore,
  TokenCodec,
  TokenSigner,
  UserRepository,
} from './ports';

export const REFRESH_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // one long shift

export interface ClientInfo {
  readonly deviceId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly correlationId: string;
}

export interface Session {
  readonly accessToken: string;
  readonly expiresAt: Date;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
  readonly user: User;
  readonly branch: BranchSummary;
  readonly branches: BranchSummary[];
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface Principal {
  readonly userId: string;
  readonly branchId: string;
  readonly sessionId: string;
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<string>;
}

export interface AuthServiceDeps {
  readonly users: UserRepository;
  readonly identity: IdentityQueries;
  readonly refreshTokens: RefreshTokenStore;
  readonly tokens: TokenCodec;
  readonly signer: TokenSigner;
  readonly hasher: PasswordHasher;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

const invalidCredentials = () =>
  new DomainError('INVALID_CREDENTIALS', 'wrong username, password or PIN');

/**
 * Sign-in, sessions and manager approval. Secrets are verified outside the
 * transaction (bcrypt is slow and async); the outcome is then recorded inside
 * one, after reloading the user, so concurrent attempts can't lose a failure.
 */
export class AuthService {
  private readonly usedApprovals = new Map<string, number>();

  constructor(private readonly d: AuthServiceDeps) {}

  async loginWithPassword(
    input: { username: string; password: string; branchId?: string | undefined },
    client: ClientInfo,
  ): Promise<Session> {
    const user = this.d.users.findByUsername(input.username.trim().toLowerCase());
    if (!user) {
      await this.d.hasher.verifyNothing();
      throw invalidCredentials();
    }
    return this.signIn(
      user,
      'PASSWORD',
      input.password,
      user.state.passwordHash,
      input.branchId,
      client,
    );
  }

  async loginWithPin(
    input: { userId: string; pin: string; branchId?: string | undefined },
    client: ClientInfo,
  ): Promise<Session> {
    const user = this.d.users.findById(input.userId);
    if (!user || !user.state.pinHash) {
      await this.d.hasher.verifyNothing();
      throw invalidCredentials();
    }
    return this.signIn(user, 'PIN', input.pin, user.state.pinHash, input.branchId, client);
  }

  private async signIn(
    user: User,
    method: 'PASSWORD' | 'PIN',
    secret: string,
    hash: string,
    requestedBranchId: string | undefined,
    client: ClientInfo,
  ): Promise<Session> {
    user.assertCanSignIn(this.d.clock.now());
    const branches = this.d.identity.branchesForUser(user.id);
    if (branches.length === 0)
      throw new DomainError('ACCOUNT_DISABLED', 'this user has no role in any branch');
    const branch = this.pickBranch(branches, requestedBranchId);
    const valid = await this.d.hasher.verify(secret, hash);
    const context = this.context(client, user.id, branch.id);

    if (!valid) {
      this.d.unitOfWork.run(context, (scope) => {
        const fresh = this.reload(user.id);
        const locked = fresh.recordFailedSignIn(this.d.clock.now());
        this.d.users.save(fresh);
        scope.audit({
          action: 'auth.login_failed',
          entityType: 'User',
          entityId: user.id,
          after: { method, locked },
        });
      });
      throw invalidCredentials();
    }

    const tokens = this.d.unitOfWork.run(context, (scope) => {
      const fresh = this.reload(user.id);
      fresh.assertCanSignIn(this.d.clock.now()); // may have locked while we hashed
      fresh.recordSignIn(this.d.clock.now());
      this.d.users.save(fresh);
      scope.audit({
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        after: { method },
      });
      return this.issueRefreshToken(fresh.id, branch.id, this.d.ids.next(), client);
    });
    return this.buildSession(user.id, branch, branches, tokens);
  }

  /** Rotates the refresh token. Reusing an old token revokes the whole session (theft signal). */
  async refresh(
    rawToken: string,
    requestedBranchId: string | undefined,
    client: ClientInfo,
  ): Promise<Session> {
    const now = this.d.clock.now();
    const record = this.d.refreshTokens.findByHash(this.d.tokens.hash(rawToken));
    if (!record || record.expiresAt <= now)
      throw new DomainError('UNAUTHENTICATED', 'session expired');

    if (record.revokedAt) {
      this.d.unitOfWork.run(this.context(client, record.userId, record.branchId), (scope) => {
        const revoked = this.d.refreshTokens.revokeFamily(record.familyId, now);
        scope.audit({
          action: 'auth.token_reuse',
          entityType: 'User',
          entityId: record.userId,
          after: { sessionId: record.familyId, revokedTokens: revoked },
          reason: 'a refresh token was used twice; the session was ended',
        });
      });
      throw new DomainError('UNAUTHENTICATED', 'session ended');
    }

    const user = this.d.users.findById(record.userId);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'session expired');
    user.assertCanSignIn(now);
    const branches = this.d.identity.branchesForUser(user.id);
    const branch = this.pickBranch(branches, requestedBranchId ?? record.branchId);

    const tokens = this.d.unitOfWork.run(this.context(client, user.id, branch.id), () => {
      const next = this.issueRefreshToken(user.id, branch.id, record.familyId, client);
      this.d.refreshTokens.revoke(record.id, now, next.id);
      return next;
    });
    return this.buildSession(user.id, branch, branches, tokens);
  }

  logout(rawToken: string, client: ClientInfo): void {
    const record = this.d.refreshTokens.findByHash(this.d.tokens.hash(rawToken));
    if (!record || record.revokedAt) return;
    this.d.unitOfWork.run(this.context(client, record.userId, record.branchId), (scope) => {
      this.d.refreshTokens.revokeFamily(record.familyId, this.d.clock.now());
      scope.audit({ action: 'auth.logout', entityType: 'User', entityId: record.userId });
    });
  }

  /** Resolves a bearer token to who is calling and what they may do, or null. */
  async authenticate(accessToken: string): Promise<Principal | null> {
    const claims = await this.d.signer.verifyAccess(accessToken);
    if (!claims) return null;
    const now = this.d.clock.now();
    if (!this.d.refreshTokens.isFamilyActive(claims.sessionId, now)) return null;
    const user = this.d.users.findById(claims.userId);
    if (!user || !user.state.isActive) return null;
    const access = this.d.identity.access(claims.userId, claims.branchId);
    if (access.roles.length === 0) return null;
    return { ...claims, roles: access.roles, permissions: new Set(access.permissions) };
  }

  /** A manager authorises one action with their PIN. Returns a 60-second, single-use token. */
  async approve(
    input: { userId: string; pin: string; permission: string },
    requester: Principal,
    client: ClientInfo,
  ): Promise<{ token: string; expiresAt: Date; approver: User }> {
    const approver = this.d.users.findById(input.userId);
    if (!approver || !approver.state.pinHash) {
      await this.d.hasher.verifyNothing();
      throw invalidCredentials();
    }
    approver.assertCanSignIn(this.d.clock.now());
    const valid = await this.d.hasher.verify(input.pin, approver.state.pinHash);
    const context = {
      ...this.context(client, requester.userId, requester.branchId),
      approverId: approver.id,
    };
    if (!valid) {
      this.d.unitOfWork.run(context, (scope) => {
        const fresh = this.reload(approver.id);
        const locked = fresh.recordFailedSignIn(this.d.clock.now());
        this.d.users.save(fresh);
        scope.audit({
          action: 'auth.approve_failed',
          entityType: 'User',
          entityId: approver.id,
          after: { permission: input.permission, locked },
        });
      });
      throw invalidCredentials();
    }
    const access = this.d.identity.access(approver.id, requester.branchId);
    if (!access.permissions.includes(input.permission)) {
      throw new DomainError(
        'FORBIDDEN',
        `${approver.state.fullName} cannot approve ${input.permission}`,
      );
    }
    const signed = await this.d.signer.signApproval({
      approverId: approver.id,
      branchId: requester.branchId,
      permission: input.permission,
    });
    this.d.unitOfWork.run(context, (scope) =>
      scope.audit({
        action: 'auth.approve',
        entityType: 'User',
        entityId: approver.id,
        after: { permission: input.permission, requestedBy: requester.userId },
      }),
    );
    return { ...signed, approver };
  }

  /**
   * Checks an approval token for one request. Each token works once: a second
   * use (a replayed header) is rejected.
   */
  async consumeApproval(
    token: string,
    permission: string,
    branchId: string,
  ): Promise<string | null> {
    const claims = await this.d.signer.verifyApproval(token);
    if (!claims || claims.permission !== permission || claims.branchId !== branchId) return null;
    const now = this.d.clock.now().getTime();
    for (const [id, expires] of this.usedApprovals)
      if (expires < now) this.usedApprovals.delete(id);
    if (this.usedApprovals.has(claims.tokenId)) return null;
    this.usedApprovals.set(claims.tokenId, now + 5 * 60_000);
    const approver = this.d.users.findById(claims.approverId);
    if (!approver?.state.isActive) return null;
    return claims.approverId;
  }

  async changeOwnPassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
    client: ClientInfo,
  ): Promise<void> {
    const user = this.reload(principal.userId);
    if (!(await this.d.hasher.verify(currentPassword, user.state.passwordHash)))
      throw invalidCredentials();
    assertAcceptablePassword(newPassword, user.state.username);
    const hash = await this.d.hasher.hash(newPassword, 'password');
    this.d.unitOfWork.run(this.context(client, user.id, principal.branchId), (scope) => {
      const fresh = this.reload(user.id);
      fresh.changePassword(hash, this.d.clock.now());
      this.d.users.save(fresh);
      scope.recordEvents(fresh.pullEvents());
      // Other sessions end; this one keeps working.
      this.d.refreshTokens.revokeAllForUser(user.id, this.d.clock.now(), principal.sessionId);
      scope.audit({ action: 'user.password_change', entityType: 'User', entityId: user.id });
    });
  }

  private pickBranch(branches: BranchSummary[], requested: string | undefined): BranchSummary {
    if (requested === undefined) return branches[0]!;
    const branch = branches.find((b) => b.id === requested);
    if (!branch) throw new DomainError('FORBIDDEN', 'you have no role in that branch');
    return branch;
  }

  private issueRefreshToken(
    userId: string,
    branchId: string,
    familyId: string,
    client: ClientInfo,
  ) {
    const { token, hash } = this.d.tokens.generate();
    const now = this.d.clock.now();
    const id = this.d.ids.next();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    this.d.refreshTokens.insert({
      id,
      userId,
      branchId,
      familyId,
      tokenHash: hash,
      expiresAt,
      revokedAt: null,
      createdAt: now,
      deviceId: client.deviceId,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    });
    return { id, token, expiresAt, familyId };
  }

  private async buildSession(
    userId: string,
    branch: BranchSummary,
    branches: BranchSummary[],
    refresh: { token: string; expiresAt: Date; familyId: string },
  ): Promise<Session> {
    const user = this.reload(userId);
    const access = this.d.identity.access(userId, branch.id);
    const signed = await this.d.signer.signAccess({
      userId,
      branchId: branch.id,
      sessionId: refresh.familyId,
    });
    return {
      accessToken: signed.token,
      expiresAt: signed.expiresAt,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      user,
      branch,
      branches,
      roles: access.roles,
      permissions: access.permissions,
    };
  }

  private reload(userId: string): User {
    const user = this.d.users.findById(userId);
    if (!user) throw new DomainError('NOT_FOUND', 'user not found');
    return user;
  }

  private context(client: ClientInfo, actorId: string, branchId: string): CommandContext {
    return {
      branchId,
      actorId,
      deviceId: client.deviceId,
      ipAddress: client.ipAddress,
      correlationId: client.correlationId,
    };
  }
}
