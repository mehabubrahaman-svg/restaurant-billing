import {
  ApproveResponseSchema,
  AuditLogPageSchema,
  AuditVerifyResponseSchema,
  BranchSettingsSchema,
  ChargeRuleSchema,
  ChargeRulesResponseSchema,
  MeResponseSchema,
  PermissionsResponseSchema,
  PinUsersResponseSchema,
  PrinterSchema,
  PrintersResponseSchema,
  RoleSchema,
  RolesResponseSchema,
  SessionResponseSchema,
  SetupResponseSchema,
  SetupStatusResponseSchema,
  TaxGroupSchema,
  TaxGroupsResponseSchema,
  UserSchema,
  UsersResponseSchema,
  type ApproveRequest,
  type CreateUserRequest,
  type LoginRequest,
  type PinLoginRequest,
  type SetupRequest,
  type UpdateBranchSettingsRequest,
  type UpdateUserRequest,
} from '@restroos/contracts';
import { apiClient as c } from './client';

/** Request bodies whose contract types are only exported as schemas. */
export interface SaveRoleBody {
  code?: string;
  name?: string;
  permissions?: string[];
  version?: number;
}
export interface TaxComponentBody {
  code: 'CGST' | 'SGST' | 'IGST' | 'VAT' | 'SURCHARGE' | 'CESS';
  rateBp: number;
  appliesTo: 'ALWAYS' | 'INTRA_STATE' | 'INTER_STATE';
}
export interface SaveTaxGroupBody {
  name?: string;
  taxType?: 'GST' | 'VAT' | 'NONE';
  taxCategory?: 'TAXABLE' | 'NIL_RATED' | 'EXEMPT' | 'NON_GST';
  invoiceSeries?: 'INV' | 'LIQ';
  isInclusive?: boolean;
  components?: TaxComponentBody[];
  isActive?: boolean;
  version?: number;
}
export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'QR_SELF' | 'KIOSK';
export interface SaveChargeRuleBody {
  name?: string;
  kind?: 'PERCENT' | 'FIXED';
  value?: number;
  orderTypes?: OrderType[];
  taxGroupId?: string | null;
  isOptional?: boolean;
  isActive?: boolean;
  version?: number;
}
export interface SavePrinterBody {
  name?: string;
  connection?: 'USB' | 'NETWORK' | 'BLUETOOTH' | 'BLE' | 'SYSTEM';
  address?: string | null;
  paperWidthMm?: 58 | 80;
  purpose?: 'BILL' | 'KOT' | 'REPORT' | 'LABEL';
  isActive?: boolean;
  version?: number;
}

/** AuditLogQuery's filter fields (its `limit` is a coerced input, typed `unknown`). */
export interface AuditFilter {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
}

const POST = 'POST' as const;
const PATCH = 'PATCH' as const;

export const api = {
  setup: {
    status: () => c.json('/setup/status', SetupStatusResponseSchema, { auth: false }),
    run: (body: SetupRequest) =>
      c.json('/setup', SetupResponseSchema, { method: POST, body, auth: false }),
  },
  auth: {
    login: (body: LoginRequest) =>
      c.json('/auth/login', SessionResponseSchema, { method: POST, body, auth: false }),
    pinLogin: (body: PinLoginRequest) =>
      c.json('/auth/pin-login', SessionResponseSchema, { method: POST, body, auth: false }),
    pinUsers: () => c.json('/auth/pin-users', PinUsersResponseSchema, { auth: false }),
    refresh: (branchId?: string) =>
      c.json('/auth/refresh', SessionResponseSchema, {
        method: POST,
        body: branchId === undefined ? {} : { branchId },
        auth: false,
      }),
    logout: () => c.void('/auth/logout', { method: POST, auth: false }),
    me: () => c.json('/auth/me', MeResponseSchema),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      c.void('/auth/change-password', { method: POST, body }),
    approve: (body: ApproveRequest) =>
      c.json('/auth/approve', ApproveResponseSchema, { method: POST, body }),
  },
  users: {
    list: () => c.json('/users', UsersResponseSchema),
    create: (body: CreateUserRequest) => c.json('/users', UserSchema, { method: POST, body }),
    update: (id: string, body: UpdateUserRequest) =>
      c.json(`/users/${id}`, UserSchema, { method: PATCH, body }),
    deactivate: (id: string) => c.void(`/users/${id}/deactivate`, { method: POST }),
    reactivate: (id: string) => c.void(`/users/${id}/reactivate`, { method: POST }),
    unlock: (id: string) => c.void(`/users/${id}/unlock`, { method: POST }),
    resetPassword: (id: string, password: string) =>
      c.void(`/users/${id}/reset-password`, { method: POST, body: { password } }),
    resetPin: (id: string, pin: string) =>
      c.void(`/users/${id}/reset-pin`, { method: POST, body: { pin } }),
  },
  roles: {
    list: () => c.json('/roles', RolesResponseSchema),
    permissions: () => c.json('/permissions', PermissionsResponseSchema),
    create: (body: SaveRoleBody) => c.json('/roles', RoleSchema, { method: POST, body }),
    update: (id: string, body: SaveRoleBody) =>
      c.json(`/roles/${id}`, RoleSchema, { method: PATCH, body }),
  },
  settings: {
    branch: () => c.json('/settings/branch', BranchSettingsSchema),
    updateBranch: (body: UpdateBranchSettingsRequest) =>
      c.json('/settings/branch', BranchSettingsSchema, { method: PATCH, body }),
  },
  taxGroups: {
    list: () => c.json('/tax-groups', TaxGroupsResponseSchema),
    create: (body: SaveTaxGroupBody) =>
      c.json('/tax-groups', TaxGroupSchema, { method: POST, body }),
    update: (id: string, body: SaveTaxGroupBody) =>
      c.json(`/tax-groups/${id}`, TaxGroupSchema, { method: PATCH, body }),
  },
  chargeRules: {
    list: () => c.json('/charge-rules', ChargeRulesResponseSchema),
    create: (body: SaveChargeRuleBody) =>
      c.json('/charge-rules', ChargeRuleSchema, { method: POST, body }),
    update: (id: string, body: SaveChargeRuleBody) =>
      c.json(`/charge-rules/${id}`, ChargeRuleSchema, { method: PATCH, body }),
  },
  printers: {
    list: () => c.json('/printers', PrintersResponseSchema),
    create: (body: SavePrinterBody) => c.json('/printers', PrinterSchema, { method: POST, body }),
    update: (id: string, body: SavePrinterBody) =>
      c.json(`/printers/${id}`, PrinterSchema, { method: PATCH, body }),
    test: (id: string) => c.void(`/printers/${id}/test`, { method: POST }),
  },
  audit: {
    list: (query: AuditFilter & { cursor?: string; limit?: number }) =>
      c.json('/audit-logs', AuditLogPageSchema, { query: { ...query, limit: query.limit ?? 50 } }),
    verify: () => c.json('/audit-logs/verify', AuditVerifyResponseSchema, { method: POST }),
  },
};
