import { z } from 'zod';
import { IdSchema, LocaleSchema } from './common';

export const PermissionCodeSchema = z.string().regex(/^[a-z_]+\.[a-z_]+$/);

export const BranchSummarySchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  stateCode: z.string(),
});
export type BranchSummary = z.infer<typeof BranchSummarySchema>;

export const SessionUserSchema = z.object({
  id: IdSchema,
  username: z.string(),
  fullName: z.string(),
  preferredLocale: LocaleSchema.nullable(),
  hasPin: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

/** Returned by login, PIN login and refresh. The refresh token travels as an httpOnly cookie. */
export const SessionResponseSchema = z.object({
  accessToken: z.string(),
  /** ISO time the access token expires (15 minutes). Refresh shortly before. */
  expiresAt: z.string(),
  user: SessionUserSchema,
  branch: BranchSummarySchema,
  /** Branches this user has any role in; switch with POST /auth/refresh { branchId }. */
  branches: z.array(BranchSummarySchema),
  roles: z.array(z.string()),
  permissions: z.array(PermissionCodeSchema),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  branchId: IdSchema.optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const PinSchema = z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');

export const PinLoginRequestSchema = z.object({
  userId: IdSchema,
  pin: PinSchema,
  branchId: IdSchema.optional(),
});
export type PinLoginRequest = z.infer<typeof PinLoginRequestSchema>;

export const RefreshRequestSchema = z.object({ branchId: IdSchema.optional() }).default({});

/** People who can sign in with a PIN on this Hub: the tiles on the PIN-pad screen. */
export const PinUserSchema = z.object({ id: IdSchema, fullName: z.string(), initials: z.string() });
export const PinUsersResponseSchema = z.object({ data: z.array(PinUserSchema) });
export type PinUser = z.infer<typeof PinUserSchema>;
export type PinUsersResponse = z.infer<typeof PinUsersResponseSchema>;

/**
 * Manager override: a manager enters their PIN on the cashier's device to
 * authorise one sensitive action. The returned token is sent once as
 * `X-Approver-Token` with the request it approves.
 */
export const ApproveRequestSchema = z.object({
  userId: IdSchema,
  pin: PinSchema,
  permission: PermissionCodeSchema,
});
export type ApproveRequest = z.infer<typeof ApproveRequestSchema>;

export const ApproveResponseSchema = z.object({
  approverToken: z.string(),
  expiresAt: z.string(),
  approver: z.object({ id: IdSchema, fullName: z.string() }),
});
export type ApproveResponse = z.infer<typeof ApproveResponseSchema>;

export const APPROVER_HEADER = 'x-approver-token';

/** GET /auth/me: the current session without the token. */
export const MeResponseSchema = SessionResponseSchema.omit({ accessToken: true, expiresAt: true });
export type MeResponse = z.infer<typeof MeResponseSchema>;
