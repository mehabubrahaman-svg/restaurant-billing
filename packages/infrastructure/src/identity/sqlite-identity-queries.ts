import type { Access, BranchSummary, IdentityQueries } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

export class SqliteIdentityQueries implements IdentityQueries {
  private readonly org;
  private readonly branches;
  private readonly roles;
  private readonly permissions;
  private readonly pin;
  private readonly admins;
  private readonly counts;

  constructor(db: SqliteDatabase) {
    this.org = db.prepare<[], string>('SELECT id FROM organizations LIMIT 1').pluck();
    this.branches = db.prepare<[string], BranchSummary>(
      `SELECT DISTINCT b.id, b.code, b.name, b.state_code AS stateCode
         FROM user_roles ur JOIN branches b ON b.id = ur.branch_id
        WHERE ur.user_id = ? AND b.is_active = 1 AND b.deleted_at IS NULL
        ORDER BY b.code`,
    );
    this.roles = db
      .prepare<[string, string], string>(
        `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = ? AND ur.branch_id = ? AND r.deleted_at IS NULL ORDER BY r.code`,
      )
      .pluck();
    this.permissions = db
      .prepare<[string, string], string>(
        `SELECT DISTINCT p.code FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = ? AND ur.branch_id = ? ORDER BY p.code`,
      )
      .pluck();
    this.pin = db.prepare<[], { id: string; fullName: string }>(
      `SELECT id, full_name AS fullName FROM users
        WHERE is_active = 1 AND deleted_at IS NULL AND pin_hash IS NOT NULL ORDER BY full_name`,
    );
    this.admins = db
      .prepare<[], string>(
        `SELECT DISTINCT u.id FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
          WHERE r.code = 'ADMIN' AND u.is_active = 1 AND u.deleted_at IS NULL`,
      )
      .pluck();
    this.counts = db.prepare<[], { role_id: string; n: number }>(
      `SELECT ur.role_id, count(DISTINCT ur.user_id) AS n FROM user_roles ur
         JOIN users u ON u.id = ur.user_id AND u.is_active = 1 GROUP BY ur.role_id`,
    );
  }

  organizationId(): string | undefined {
    return this.org.get();
  }

  branchesForUser(userId: string): BranchSummary[] {
    return this.branches.all(userId);
  }

  access(userId: string, branchId: string): Access {
    return {
      roles: this.roles.all(userId, branchId),
      permissions: this.permissions.all(userId, branchId),
    };
  }

  pinUsers(): { id: string; fullName: string }[] {
    return this.pin.all();
  }

  activeAdminIds(): string[] {
    return this.admins.all();
  }

  roleUserCounts(): Map<string, number> {
    return new Map(this.counts.all().map((r) => [r.role_id, r.n]));
  }
}
