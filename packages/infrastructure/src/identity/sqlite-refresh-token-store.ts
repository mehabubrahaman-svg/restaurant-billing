import type { NewRefreshToken, RefreshTokenRecord, RefreshTokenStore } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

interface Row {
  id: string;
  user_id: string;
  branch_id: string;
  family_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export class SqliteRefreshTokenStore implements RefreshTokenStore {
  private readonly byHash;
  private readonly insertRow;
  private readonly revokeRow;
  private readonly revokeFamilyRows;
  private readonly revokeUserRows;
  private readonly familyActive;

  constructor(db: SqliteDatabase) {
    this.byHash = db.prepare<[string], Row>(
      'SELECT id, user_id, branch_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?',
    );
    this.insertRow = db.prepare(
      `INSERT INTO refresh_tokens (id, user_id, branch_id, device_id, family_id, token_hash, expires_at,
                                   created_at, ip_address, user_agent)
       VALUES (@id, @userId, @branchId, @deviceId, @familyId, @tokenHash, @expiresAt, @createdAt,
               @ipAddress, @userAgent)`,
    );
    this.revokeRow = db.prepare(
      'UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ? AND revoked_at IS NULL',
    );
    this.revokeFamilyRows = db.prepare(
      'UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL',
    );
    this.revokeUserRows = db.prepare(
      `UPDATE refresh_tokens SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL AND family_id IS NOT ?`,
    );
    this.familyActive = db
      .prepare<[string, string], number>(
        `SELECT EXISTS (SELECT 1 FROM refresh_tokens
                         WHERE family_id = ? AND revoked_at IS NULL AND expires_at > ?)`,
      )
      .pluck();
  }

  findByHash(tokenHash: string): RefreshTokenRecord | undefined {
    const row = this.byHash.get(tokenHash);
    return (
      row && {
        id: row.id,
        userId: row.user_id,
        branchId: row.branch_id,
        familyId: row.family_id,
        expiresAt: new Date(row.expires_at),
        revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
      }
    );
  }

  insert(token: NewRefreshToken): void {
    this.insertRow.run({
      ...token,
      expiresAt: token.expiresAt.toISOString(),
      createdAt: token.createdAt.toISOString(),
    });
  }

  revoke(id: string, at: Date, replacedBy: string | null): void {
    this.revokeRow.run(at.toISOString(), replacedBy, id);
  }

  revokeFamily(familyId: string, at: Date): number {
    return this.revokeFamilyRows.run(at.toISOString(), familyId).changes;
  }

  revokeAllForUser(userId: string, at: Date, exceptFamilyId?: string): number {
    return this.revokeUserRows.run(at.toISOString(), userId, exceptFamilyId ?? null).changes;
  }

  isFamilyActive(familyId: string, now: Date): boolean {
    return this.familyActive.get(familyId, now.toISOString()) === 1;
  }
}
