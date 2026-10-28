import { AggregateRoot } from '../shared/aggregate-root';
import { DomainError } from '../shared/result';
import { isPermissionCode, type PermissionCode } from './permissions';

export interface RoleState {
  organizationId: string;
  code: string;
  name: string;
  isSystem: boolean;
  isLocked: boolean;
  permissions: Set<PermissionCode>;
}

export class Role extends AggregateRoot {
  readonly aggregateType = 'Role';

  private constructor(
    id: string,
    version: number,
    private readonly s: RoleState,
  ) {
    super(id, version);
  }

  static restore(id: string, version: number, state: RoleState): Role {
    return new Role(id, version, state);
  }

  static create(
    id: string,
    input: { organizationId: string; code: string; name: string; permissions: readonly string[] },
    at: Date,
  ): Role {
    const role = new Role(id, 0, {
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      isSystem: false,
      isLocked: false,
      permissions: parsePermissions(input.permissions),
    });
    role.raise(
      'RoleCreated',
      { code: input.code, name: input.name, permissions: [...role.s.permissions] },
      at,
    );
    return role;
  }

  get state(): Readonly<RoleState> {
    return this.s;
  }

  rename(name: string, at: Date): void {
    this.assertEditable();
    this.s.name = name;
    this.raise('RoleRenamed', { name }, at);
  }

  setPermissions(permissions: readonly string[], at: Date): void {
    this.assertEditable();
    this.s.permissions = parsePermissions(permissions);
    this.raise('RolePermissionsChanged', { permissions: [...this.s.permissions] }, at);
  }

  private assertEditable(): void {
    if (this.s.isLocked) throw new DomainError('ROLE_LOCKED', `${this.s.code} cannot be changed`);
  }
}

function parsePermissions(codes: readonly string[]): Set<PermissionCode> {
  const unknown = codes.filter((c) => !isPermissionCode(c));
  if (unknown.length > 0) {
    throw new DomainError('PERMISSION_UNKNOWN', `unknown permissions: ${unknown.join(', ')}`, {
      unknown,
    });
  }
  return new Set(codes as PermissionCode[]);
}
