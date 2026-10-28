import { DomainError, Role } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type { IdentityQueries, RoleRepository } from './ports';

export interface RoleAdminDeps {
  readonly roles: RoleRepository;
  readonly identity: IdentityQueries;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Custom roles and permission changes (permission roles.manage). */
export class RoleAdminService {
  constructor(private readonly d: RoleAdminDeps) {}

  create(input: { code: string; name: string; permissions: string[] }, ctx: CommandContext): Role {
    return this.d.unitOfWork.run(ctx, (scope) => {
      if (this.d.roles.findByCode(input.code)) {
        throw new DomainError('ROLE_CODE_TAKEN', `a role with code ${input.code} already exists`);
      }
      const organizationId = this.d.identity.organizationId();
      if (!organizationId) throw new DomainError('SETUP_REQUIRED', 'run first-time setup first');
      const role = Role.create(this.d.ids.next(), { organizationId, ...input }, this.d.clock.now());
      this.d.roles.insert(role);
      scope.recordEvents(role.pullEvents());
      scope.audit({ action: 'role.create', entityType: 'Role', entityId: role.id, after: input });
      return role;
    });
  }

  update(
    roleId: string,
    input: { version: number; name?: string | undefined; permissions?: string[] | undefined },
    ctx: CommandContext,
  ): Role {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const role = this.d.roles.findById(roleId);
      if (!role) throw new DomainError('NOT_FOUND', 'role not found');
      if (role.version !== input.version) {
        throw new DomainError(
          'VERSION_CONFLICT',
          'this role was changed by someone else; reload and try again',
        );
      }
      const before = { name: role.state.name, permissions: [...role.state.permissions] };
      const now = this.d.clock.now();
      if (input.name !== undefined) role.rename(input.name, now);
      if (input.permissions !== undefined) role.setPermissions(input.permissions, now);
      this.d.roles.save(role);
      scope.recordEvents(role.pullEvents());
      scope.audit({
        action: 'role.update',
        entityType: 'Role',
        entityId: role.id,
        before,
        after: { name: role.state.name, permissions: [...role.state.permissions] },
      });
      return role;
    });
  }
}
