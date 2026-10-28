import { z } from 'zod';
import { PermissionCodeSchema, PinSchema } from './auth';
import { IdSchema, LocaleSchema } from './common';
import { PasswordSchema } from './setup';

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, '3 to 32 lowercase letters, digits, . _ -');

export const UserSchema = z.object({
  id: IdSchema,
  username: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  preferredLocale: LocaleSchema.nullable(),
  isActive: z.boolean(),
  hasPin: z.boolean(),
  lockedUntil: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  /** Role ids in the current branch. */
  roleIds: z.array(IdSchema),
  version: z.number().int(),
});
export type User = z.infer<typeof UserSchema>;
export const UsersResponseSchema = z.object({ data: z.array(UserSchema) });
export type UsersResponse = z.infer<typeof UsersResponseSchema>;

export const CreateUserRequestSchema = z.object({
  username: UsernameSchema,
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(20).optional(),
  email: z.email().optional(),
  preferredLocale: LocaleSchema.optional(),
  password: PasswordSchema,
  pin: PinSchema.optional(),
  roleIds: z.array(IdSchema).min(1),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  version: z.number().int(),
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z.email().nullable().optional(),
  preferredLocale: LocaleSchema.nullable().optional(),
  roleIds: z.array(IdSchema).min(1).optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const ResetPasswordRequestSchema = z.object({ password: PasswordSchema });
export const ResetPinRequestSchema = z.object({ pin: PinSchema });
/** Users change their own password with the current one. */
export const ChangeOwnPasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: PasswordSchema,
});

export const PermissionSchema = z.object({
  code: PermissionCodeSchema,
  module: z.string(),
  description: z.string(),
});
export const PermissionsResponseSchema = z.object({ data: z.array(PermissionSchema) });
export type PermissionsResponse = z.infer<typeof PermissionsResponseSchema>;
export type Permission = z.infer<typeof PermissionSchema>;

export const RoleSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  /** Built-in roles cannot be renamed; ADMIN's permissions are fixed. */
  isSystem: z.boolean(),
  isLocked: z.boolean(),
  permissions: z.array(PermissionCodeSchema),
  userCount: z.number().int(),
  version: z.number().int(),
});
export type Role = z.infer<typeof RoleSchema>;
export const RolesResponseSchema = z.object({ data: z.array(RoleSchema) });
export type RolesResponse = z.infer<typeof RolesResponseSchema>;

export const CreateRoleRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,31}$/),
  name: z.string().trim().min(2).max(60),
  permissions: z.array(PermissionCodeSchema),
});
export const UpdateRoleRequestSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(2).max(60).optional(),
  permissions: z.array(PermissionCodeSchema).optional(),
});
