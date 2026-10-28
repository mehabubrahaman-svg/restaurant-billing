import type { Role, User } from '@restroos/domain';

export interface PasswordHasher {
  hash(secret: string, kind: 'password' | 'pin'): Promise<string>;
  verify(secret: string, hash: string): Promise<boolean>;
  /** Burns the same time as a real verify, so unknown usernames can't be detected by timing. */
  verifyNothing(): Promise<void>;
}

export interface UserRepository {
  findById(id: string): User | undefined;
  findByUsername(username: string): User | undefined;
  insert(user: User): void;
  /** Saves with an optimistic version check; throws VERSION_CONFLICT. */
  save(user: User): void;
}

export interface RoleRepository {
  findById(id: string): Role | undefined;
  findByCode(code: string): Role | undefined;
  insert(role: Role): void;
  save(role: Role): void;
}

export interface BranchSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly stateCode: string;
}

export interface Access {
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

/** Read-side lookups used on every authenticated request; must be cheap. */
export interface IdentityQueries {
  organizationId(): string | undefined;
  branchesForUser(userId: string): BranchSummary[];
  access(userId: string, branchId: string): Access;
  /** Active users who have a PIN, for the PIN-pad tiles. */
  pinUsers(): { id: string; fullName: string }[];
  /** Active users holding ADMIN in any branch. */
  activeAdminIds(): string[];
  roleUserCounts(): Map<string, number>;
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly branchId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface NewRefreshToken extends RefreshTokenRecord {
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly deviceId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface RefreshTokenStore {
  findByHash(tokenHash: string): RefreshTokenRecord | undefined;
  insert(token: NewRefreshToken): void;
  revoke(id: string, at: Date, replacedBy: string | null): void;
  revokeFamily(familyId: string, at: Date): number;
  /** Ends every session of the user, optionally keeping one (the caller's own). */
  revokeAllForUser(userId: string, at: Date, exceptFamilyId?: string): number;
  /** True while the session has an unrevoked, unexpired token. */
  isFamilyActive(familyId: string, now: Date): boolean;
}

/** Opaque random tokens and their one-way hash (we only store hashes). */
export interface TokenCodec {
  generate(): { token: string; hash: string };
  hash(token: string): string;
}

export interface AccessClaims {
  readonly userId: string;
  readonly branchId: string;
  readonly sessionId: string;
}

export interface ApprovalClaims {
  readonly approverId: string;
  readonly branchId: string;
  readonly permission: string;
  readonly tokenId: string;
}

export interface TokenSigner {
  signAccess(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }>;
  verifyAccess(token: string): Promise<AccessClaims | null>;
  signApproval(
    claims: Omit<ApprovalClaims, 'tokenId'>,
  ): Promise<{ token: string; expiresAt: Date }>;
  verifyApproval(token: string): Promise<ApprovalClaims | null>;
}
