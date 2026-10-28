import {
  CreateRoleRequestSchema,
  CreateUserRequestSchema,
  ResetPasswordRequestSchema,
  ResetPinRequestSchema,
  UpdateRoleRequestSchema,
  UpdateUserRequestSchema,
  type PermissionsResponse,
  type Role as RoleDto,
  type RolesResponse,
  type User as UserDto,
  type UsersResponse,
} from '@restroos/contracts';
import { DomainError, type Role, type User } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
const MANAGE_USERS = { permission: 'users.manage' } as const;
const MANAGE_ROLES = { permission: 'roles.manage' } as const;
const READ_ROLES = { permission: ['users.manage', 'roles.manage'] } as const;

export async function userRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { userAdmin, roleAdmin, users, roles, db, identityQueries } = cradle;
  const branchOf = (request: FastifyRequest) => request.principal!.branchId;

  const toUser = (user: User, branchId: string): UserDto => {
    const s = user.state;
    return {
      id: user.id,
      username: s.username,
      fullName: s.fullName,
      phone: s.phone,
      email: s.email,
      preferredLocale: (s.preferredLocale as UserDto['preferredLocale']) ?? null,
      isActive: s.isActive,
      hasPin: s.pinHash !== null,
      lockedUntil:
        s.lockedUntil && s.lockedUntil > cradle.clock.now() ? s.lockedUntil.toISOString() : null,
      lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
      roleIds: [...(s.roles.get(branchId) ?? [])],
      version: user.version,
    };
  };

  const toRole = (role: Role, counts: Map<string, number>): RoleDto => ({
    id: role.id,
    code: role.state.code,
    name: role.state.name,
    isSystem: role.state.isSystem,
    isLocked: role.state.isLocked,
    permissions: [...role.state.permissions].sort(),
    userCount: counts.get(role.id) ?? 0,
    version: role.version,
  });

  const loadUser = (id: string) => {
    const user = users.findById(id);
    if (!user) throw new DomainError('NOT_FOUND', 'user not found');
    return user;
  };

  // ---- users -------------------------------------------------------------
  app.get('/users', { config: MANAGE_USERS }, async (request): Promise<UsersResponse> => {
    const ids = db
      .prepare<[], string>(
        'SELECT id FROM users WHERE deleted_at IS NULL ORDER BY is_active DESC, full_name',
      )
      .pluck()
      .all();
    return { data: ids.map((id) => toUser(loadUser(id), branchOf(request))) };
  });

  app.post('/users', { config: MANAGE_USERS }, async (request, reply) => {
    const body = CreateUserRequestSchema.parse(request.body);
    const user = await userAdmin.create(body, commandContext(request));
    reply.status(201);
    return toUser(user, branchOf(request));
  });

  app.patch('/users/:id', { config: MANAGE_USERS }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = UpdateUserRequestSchema.parse(request.body);
    return toUser(userAdmin.update(id, body, commandContext(request)), branchOf(request));
  });

  const action = (
    path: string,
    run: (id: string, request: FastifyRequest) => User | Promise<User>,
  ) =>
    app.post(`/users/:id/${path}`, { config: MANAGE_USERS }, async (request) => {
      const { id } = IdParams.parse(request.params);
      return toUser(await run(id, request), branchOf(request));
    });
  action('deactivate', (id, r) => userAdmin.deactivate(id, commandContext(r)));
  action('reactivate', (id, r) => userAdmin.reactivate(id, commandContext(r)));
  action('unlock', (id, r) => userAdmin.unlock(id, commandContext(r)));
  action('reset-password', (id, r) =>
    userAdmin.resetPassword(
      id,
      ResetPasswordRequestSchema.parse(r.body).password,
      commandContext(r),
    ),
  );
  action('reset-pin', (id, r) =>
    userAdmin.resetPin(id, ResetPinRequestSchema.parse(r.body).pin, commandContext(r)),
  );

  // ---- roles & permissions ----------------------------------------------
  app.get('/permissions', { config: READ_ROLES }, async (): Promise<PermissionsResponse> => ({
    data: db
      .prepare<[], { code: string; module: string; description: string }>(
        'SELECT code, module, description FROM permissions ORDER BY module, code',
      )
      .all(),
  }));

  app.get('/roles', { config: READ_ROLES }, async (): Promise<RolesResponse> => {
    const counts = identityQueries.roleUserCounts();
    const ids = db
      .prepare<[], string>(
        'SELECT id FROM roles WHERE deleted_at IS NULL ORDER BY is_system DESC, name',
      )
      .pluck()
      .all();
    return { data: ids.map((id) => toRole(roles.findById(id)!, counts)) };
  });

  app.post('/roles', { config: MANAGE_ROLES }, async (request, reply) => {
    const body = CreateRoleRequestSchema.parse(request.body);
    const role = roleAdmin.create(body, commandContext(request));
    reply.status(201);
    return toRole(role, identityQueries.roleUserCounts());
  });

  app.patch('/roles/:id', { config: MANAGE_ROLES }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = UpdateRoleRequestSchema.parse(request.body);
    return toRole(
      roleAdmin.update(id, body, commandContext(request)),
      identityQueries.roleUserCounts(),
    );
  });
}
