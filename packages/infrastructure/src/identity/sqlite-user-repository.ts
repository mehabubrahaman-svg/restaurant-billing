import type { UserRepository } from '@restroos/application';
import { User } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

interface UserRow {
  id: string;
  organization_id: string;
  username: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_locale: string | null;
  password_hash: string;
  pin_hash: string | null;
  is_active: number;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  version: number;
}

const date = (v: string | null) => (v === null ? null : new Date(v));

export class SqliteUserRepository implements UserRepository {
  private readonly byId;
  private readonly byUsername;
  private readonly rolesOf;
  private readonly insertRow;
  private readonly updateRow;
  private readonly clearRoles;
  private readonly addRole;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => Date,
  ) {
    this.byId = db.prepare<[string], UserRow>(
      'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL',
    );
    this.byUsername = db.prepare<[string], UserRow>(
      'SELECT * FROM users WHERE username = ? AND deleted_at IS NULL',
    );
    this.rolesOf = db.prepare<[string], { branch_id: string; role_id: string }>(
      'SELECT branch_id, role_id FROM user_roles WHERE user_id = ?',
    );
    this.insertRow = db.prepare(
      `INSERT INTO users (id, organization_id, username, full_name, phone, email, preferred_locale,
                          password_hash, pin_hash, is_active, failed_logins, locked_until, last_login_at,
                          created_at, updated_at, version)
       VALUES (@id, @organization_id, @username, @full_name, @phone, @email, @preferred_locale,
               @password_hash, @pin_hash, @is_active, @failed_logins, @locked_until, @last_login_at,
               @now, @now, @version)`,
    );
    this.updateRow = db.prepare(
      `UPDATE users SET full_name = @full_name, phone = @phone, email = @email,
              preferred_locale = @preferred_locale, password_hash = @password_hash, pin_hash = @pin_hash,
              is_active = @is_active, failed_logins = @failed_logins, locked_until = @locked_until,
              last_login_at = @last_login_at, updated_at = @now, version = @version
        WHERE id = @id AND version = @expected`,
    );
    // user_roles is a configuration link, deletable by design (audited in audit_logs).
    // eslint-disable-next-line no-restricted-syntax
    this.clearRoles = db.prepare('DELETE FROM user_roles WHERE user_id = ? AND branch_id = ?');
    this.addRole = db.prepare(
      'INSERT INTO user_roles (user_id, role_id, branch_id, assigned_at) VALUES (?, ?, ?, ?)',
    );
  }

  findById(id: string): User | undefined {
    const row = this.byId.get(id);
    return row && this.toUser(row);
  }

  findByUsername(username: string): User | undefined {
    const row = this.byUsername.get(username);
    return row && this.toUser(row);
  }

  insert(user: User): void {
    this.insertRow.run({ ...this.toRow(user), now: this.now().toISOString() });
    this.writeRoles(user, true);
    user.markPersisted();
  }

  save(user: User): void {
    const result = this.updateRow.run({
      ...this.toRow(user),
      now: this.now().toISOString(),
      expected: user.persistedVersion,
    });
    assertVersionMatched(result, 'User', user.id);
    this.writeRoles(user, false);
    user.markPersisted();
  }

  private writeRoles(user: User, isNew: boolean): void {
    const stored = isNew ? [] : this.rolesOf.all(user.id);
    const now = this.now().toISOString();
    for (const [branchId, roleIds] of user.state.roles) {
      const current = stored.filter((r) => r.branch_id === branchId).map((r) => r.role_id);
      const same = current.length === roleIds.size && current.every((id) => roleIds.has(id));
      if (same) continue;
      this.clearRoles.run(user.id, branchId);
      for (const roleId of roleIds) this.addRole.run(user.id, roleId, branchId, now);
    }
  }

  private toUser(row: UserRow): User {
    const roles = new Map<string, Set<string>>();
    for (const { branch_id, role_id } of this.rolesOf.all(row.id)) {
      if (!roles.has(branch_id)) roles.set(branch_id, new Set());
      roles.get(branch_id)!.add(role_id);
    }
    return User.restore(row.id, row.version, {
      organizationId: row.organization_id,
      username: row.username,
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      preferredLocale: row.preferred_locale,
      passwordHash: row.password_hash,
      pinHash: row.pin_hash,
      isActive: row.is_active === 1,
      failedLogins: row.failed_logins,
      lockedUntil: date(row.locked_until),
      lastLoginAt: date(row.last_login_at),
      roles,
    });
  }

  private toRow(user: User): Omit<UserRow, never> {
    const s = user.state;
    return {
      id: user.id,
      organization_id: s.organizationId,
      username: s.username,
      full_name: s.fullName,
      phone: s.phone,
      email: s.email,
      preferred_locale: s.preferredLocale,
      password_hash: s.passwordHash,
      pin_hash: s.pinHash,
      is_active: s.isActive ? 1 : 0,
      failed_logins: s.failedLogins,
      locked_until: s.lockedUntil?.toISOString() ?? null,
      last_login_at: s.lastLoginAt?.toISOString() ?? null,
      version: user.version,
    };
  }
}
