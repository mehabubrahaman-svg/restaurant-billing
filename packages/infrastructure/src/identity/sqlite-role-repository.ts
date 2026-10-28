import type { RoleRepository } from '@restroos/application';
import { Role, type PermissionCode } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

interface RoleRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  is_system: number;
  version: number;
}

/** ADMIN is the one locked role: it always holds every permission. */
const LOCKED_CODES = new Set(['ADMIN']);

export class SqliteRoleRepository implements RoleRepository {
  private readonly byId;
  private readonly byCode;
  private readonly permissionsOf;
  private readonly permissionId;
  private readonly insertRow;
  private readonly updateRow;
  private readonly clearPermissions;
  private readonly grant;

  constructor(
    db: SqliteDatabase,
    private readonly now: () => Date,
  ) {
    this.byId = db.prepare<[string], RoleRow>(
      'SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL',
    );
    this.byCode = db.prepare<[string], RoleRow>(
      'SELECT * FROM roles WHERE code = ? AND deleted_at IS NULL',
    );
    this.permissionsOf = db
      .prepare<[string], string>(
        `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = ?`,
      )
      .pluck();
    this.permissionId = db
      .prepare<[string], string>('SELECT id FROM permissions WHERE code = ?')
      .pluck();
    this.insertRow = db.prepare(
      `INSERT INTO roles (id, organization_id, code, name, is_system, created_at, updated_at, version)
       VALUES (@id, @organization_id, @code, @name, @is_system, @now, @now, @version)`,
    );
    this.updateRow = db.prepare(
      'UPDATE roles SET name = @name, updated_at = @now, version = @version WHERE id = @id AND version = @expected',
    );
    // role_permissions is a configuration link, deletable by design (audited).
    // eslint-disable-next-line no-restricted-syntax
    this.clearPermissions = db.prepare('DELETE FROM role_permissions WHERE role_id = ?');
    this.grant = db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id, granted_at) VALUES (?, ?, ?)',
    );
  }

  findById(id: string): Role | undefined {
    const row = this.byId.get(id);
    return row && this.toRole(row);
  }

  findByCode(code: string): Role | undefined {
    const row = this.byCode.get(code);
    return row && this.toRole(row);
  }

  insert(role: Role): void {
    const s = role.state;
    this.insertRow.run({
      id: role.id,
      organization_id: s.organizationId,
      code: s.code,
      name: s.name,
      is_system: s.isSystem ? 1 : 0,
      now: this.now().toISOString(),
      version: role.version,
    });
    this.writePermissions(role);
    role.markPersisted();
  }

  save(role: Role): void {
    const result = this.updateRow.run({
      id: role.id,
      name: role.state.name,
      now: this.now().toISOString(),
      version: role.version,
      expected: role.persistedVersion,
    });
    assertVersionMatched(result, 'Role', role.id);
    this.writePermissions(role);
    role.markPersisted();
  }

  private writePermissions(role: Role): void {
    this.clearPermissions.run(role.id);
    const now = this.now().toISOString();
    for (const code of role.state.permissions) {
      const id = this.permissionId.get(code);
      if (!id) throw new Error(`permission ${code} missing from the database`);
      this.grant.run(role.id, id, now);
    }
  }

  private toRole(row: RoleRow): Role {
    return Role.restore(row.id, row.version, {
      organizationId: row.organization_id,
      code: row.code,
      name: row.name,
      isSystem: row.is_system === 1,
      isLocked: LOCKED_CODES.has(row.code),
      permissions: new Set(this.permissionsOf.all(row.id) as PermissionCode[]),
    });
  }
}
