import {
  API_PREFIX,
  AddonGroupSchema,
  AddonGroupsResponseSchema,
  ApproveResponseSchema,
  AuditLogPageSchema,
  AuditVerifyResponseSchema,
  BranchSettingsSchema,
  ChefsResponseSchema,
  FireKotsResponseSchema,
  KitchenMetricsSchema,
  KotSchema,
  KotsResponseSchema,
  OrderSchema,
  OrdersResponseSchema,
  TokenBoardSchema,
  CategoriesResponseSchema,
  CategorySchema,
  DeviceSchema,
  DevicesResponseSchema,
  DiningTableSchema,
  FloorAreaSchema,
  FloorResponseSchema,
  HubInfoSchema,
  KitchenStationSchema,
  KitchenStationsResponseSchema,
  ChargeRuleSchema,
  ChargeRulesResponseSchema,
  MenuImportResponseSchema,
  MenuItemSchema,
  MenuItemsResponseSchema,
  MenuSnapshotSchema,
  MeResponseSchema,
  PairDeviceResponseSchema,
  PairingCodeResponseSchema,
  PeripheralSchema,
  PeripheralsResponseSchema,
  PermissionsResponseSchema,
  PinUsersResponseSchema,
  PrinterSchema,
  PrintersResponseSchema,
  RoleSchema,
  RolesResponseSchema,
  SessionResponseSchema,
  SetupResponseSchema,
  SetupStatusResponseSchema,
  TableQrResponseSchema,
  TaxGroupSchema,
  TaxGroupsResponseSchema,
  UserSchema,
  UsersResponseSchema,
  type ApproveRequest,
  type CreateUserRequest,
  type DeviceKind,
  type Peripheral,
  type LoginRequest,
  type NewOrderItem,
  type OpenOrderRequest,
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

/** `{ hi?, bn? }`: customer-facing names in the other launch languages. */
export interface TranslationsBody {
  hi?: string;
  bn?: string;
}
export type FoodType = 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN' | 'NA';
export interface SaveStationBody {
  name?: string;
  isActive?: boolean;
  version?: number;
}
export interface SaveCategoryBody {
  name?: string;
  nameTranslations?: TranslationsBody;
  parentId?: string | null;
  color?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  version?: number;
}
export interface SaveAddonGroupBody {
  name?: string;
  nameTranslations?: TranslationsBody;
  minSelect?: number;
  maxSelect?: number;
  /** The full list: addons left out are retired. */
  addons?: { id?: string; name: string; nameTranslations: TranslationsBody; price: number }[];
  isActive?: boolean;
  version?: number;
}
export interface SaveMenuItemBody {
  sku?: string;
  name?: string;
  shortName?: string | null;
  nameTranslations?: TranslationsBody;
  description?: string | null;
  descriptionTranslations?: TranslationsBody;
  categoryId?: string;
  foodType?: FoodType;
  basePrice?: number;
  taxGroupId?: string | null;
  hsnSacCode?: string | null;
  kitchenStationId?: string | null;
  prepTimeSec?: number | null;
  sortOrder?: number;
  /** The full list: variants left out are retired. */
  variants?: { id?: string; name: string; nameTranslations: TranslationsBody; price: number }[];
  addonGroupIds?: string[];
  isActive?: boolean;
  version?: number;
}
export type TableShape = 'SQUARE' | 'ROUND' | 'RECT' | 'BOOTH';
export type ManualTableStatus = 'AVAILABLE' | 'RESERVED' | 'CLEANING' | 'BLOCKED';
export interface SaveFloorAreaBody {
  name?: string;
  sortOrder?: number;
  isActive?: boolean;
  version?: number;
}
export interface SaveTableBody {
  floorAreaId?: string;
  label?: string;
  seats?: number;
  shape?: TableShape;
  posX?: number;
  posY?: number;
  isActive?: boolean;
  version?: number;
}
export interface LayoutMove {
  id: string;
  posX: number;
  posY: number;
  version: number;
}
export type DevicePlatform = 'WINDOWS' | 'LINUX' | 'ANDROID' | 'IOS' | 'IPADOS' | 'OTHER';
export interface UpdateDeviceBody {
  version: number;
  name?: string;
  kind?: DeviceKind;
  isActive?: boolean;
}
export interface SavePeripheralBody {
  name?: string;
  kind?: Peripheral['kind'];
  connection?: Peripheral['connection'];
  deviceId?: string | null;
  address?: string | null;
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

export interface UpdateOrderBody {
  version: number;
  covers?: number | null;
  notes?: string | null;
}
export interface UpdateOrderItemBody {
  version: number;
  quantity?: number;
  specialNote?: string | null;
  course?: number;
}
export interface CancelOrderItemBody {
  version: number;
  reason?: string;
  isWastage: boolean;
}
export interface CancelOrderBody {
  version: number;
  reason: string;
}
export type TransferMode = 'MOVE' | 'MERGE';
export type KotTarget = 'ACCEPTED' | 'COOKING' | 'READY' | 'SERVED';

/** Per-call extras for commands: a retry-safe key and a manager's approval. */
export interface CommandOptions {
  readonly idempotencyKey?: string;
  readonly approverToken?: string;
}
const extras = (o: CommandOptions = {}) => ({
  ...(o.idempotencyKey === undefined ? {} : { idempotencyKey: o.idempotencyKey }),
  ...(o.approverToken === undefined ? {} : { approverToken: o.approverToken }),
});

const POST = 'POST' as const;
const PATCH = 'PATCH' as const;
const PUT = 'PUT' as const;

/** Where the browser downloads the Hub's local CA certificate (public, PEM). */
export const HUB_CA_CERT_URL = `${API_PREFIX}/hub/ca.crt`;

/**
 * PUT /floor/layout answers with the updated tables. Accept either a bare
 * array or `{ data: [...] }` / `{ tables: [...] }`, since the contract only says "returns the
 * updated tables".
 */
const TablesSchema = {
  parse(input: unknown) {
    const list = Array.isArray(input)
      ? input
      : typeof input === 'object' && input !== null && 'tables' in input
        ? (input as { tables: unknown }).tables
        : typeof input === 'object' && input !== null && 'data' in input
          ? (input as { data: unknown }).data
          : input;
    if (!Array.isArray(list)) throw new Error('not a table list');
    return list.map((t) => DiningTableSchema.parse(t));
  },
};

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
  menu: {
    stations: () => c.json('/kitchen-stations', KitchenStationsResponseSchema),
    createStation: (body: SaveStationBody) =>
      c.json('/kitchen-stations', KitchenStationSchema, { method: POST, body }),
    updateStation: (id: string, body: SaveStationBody) =>
      c.json(`/kitchen-stations/${id}`, KitchenStationSchema, { method: PATCH, body }),
    categories: () => c.json('/categories', CategoriesResponseSchema),
    createCategory: (body: SaveCategoryBody) =>
      c.json('/categories', CategorySchema, { method: POST, body }),
    updateCategory: (id: string, body: SaveCategoryBody) =>
      c.json(`/categories/${id}`, CategorySchema, { method: PATCH, body }),
    addonGroups: () => c.json('/addon-groups', AddonGroupsResponseSchema),
    createAddonGroup: (body: SaveAddonGroupBody) =>
      c.json('/addon-groups', AddonGroupSchema, { method: POST, body }),
    updateAddonGroup: (id: string, body: SaveAddonGroupBody) =>
      c.json(`/addon-groups/${id}`, AddonGroupSchema, { method: PATCH, body }),
    items: () =>
      c.json('/menu-items', MenuItemsResponseSchema, { query: { includeInactive: true } }),
    createItem: (body: SaveMenuItemBody) =>
      c.json('/menu-items', MenuItemSchema, { method: POST, body }),
    updateItem: (id: string, body: SaveMenuItemBody) =>
      c.json(`/menu-items/${id}`, MenuItemSchema, { method: PATCH, body }),
    setAvailability: (id: string, isAvailable: boolean) =>
      c.void(`/menu-items/${id}/availability`, { method: POST, body: { isAvailable } }),
    /** Active menu for ordering devices; `null` when our copy (by ETag) is current. */
    snapshot: (etag: string | null) => c.cached('/menu', MenuSnapshotSchema, etag),
    import: (csv: string, dryRun: boolean) =>
      c.json('/menu/import', MenuImportResponseSchema, { method: POST, body: { csv, dryRun } }),
  },
  floor: {
    get: () => c.json('/floor', FloorResponseSchema),
    createArea: (body: SaveFloorAreaBody) =>
      c.json('/floor-areas', FloorAreaSchema, { method: POST, body }),
    updateArea: (id: string, body: SaveFloorAreaBody) =>
      c.json(`/floor-areas/${id}`, FloorAreaSchema, { method: PATCH, body }),
    createTable: (body: SaveTableBody) =>
      c.json('/tables', DiningTableSchema, { method: POST, body }),
    updateTable: (id: string, body: SaveTableBody) =>
      c.json(`/tables/${id}`, DiningTableSchema, { method: PATCH, body }),
    saveLayout: (tables: LayoutMove[]) =>
      c.json('/floor/layout', TablesSchema, { method: PUT, body: { tables } }),
    setStatus: (id: string, status: ManualTableStatus, version: number) =>
      c.json(`/tables/${id}/status`, DiningTableSchema, {
        method: POST,
        body: { status, version },
      }),
    qr: (id: string) => c.json(`/tables/${id}/qr`, TableQrResponseSchema),
    /** MOVE to a free table, or MERGE into the open order on the target. Returns the resulting order. */
    transfer: (id: string, targetTableId: string, mode: TransferMode, o?: CommandOptions) =>
      c.json(`/tables/${id}/transfer`, OrderSchema, {
        method: POST,
        body: { targetTableId, mode },
        ...extras(o),
      }),
    rotateQr: (id: string) => c.json(`/tables/${id}/qr`, TableQrResponseSchema, { method: POST }),
  },
  orders: {
    open: (body: OpenOrderRequest, o?: CommandOptions) =>
      c.json('/orders', OrderSchema, { method: POST, body, ...extras(o) }),
    listOpen: () => c.json('/orders', OrdersResponseSchema, { query: { status: 'OPEN' } }),
    get: (id: string) => c.json(`/orders/${id}`, OrderSchema),
    update: (id: string, body: UpdateOrderBody, o?: CommandOptions) =>
      c.json(`/orders/${id}`, OrderSchema, { method: PATCH, body, ...extras(o) }),
    addItems: (id: string, items: NewOrderItem[], o?: CommandOptions) =>
      c.json(`/orders/${id}/items`, OrderSchema, { method: POST, body: { items }, ...extras(o) }),
    updateItem: (id: string, itemId: string, body: UpdateOrderItemBody, o?: CommandOptions) =>
      c.json(`/orders/${id}/items/${itemId}`, OrderSchema, { method: PATCH, body, ...extras(o) }),
    cancelItem: (id: string, itemId: string, body: CancelOrderItemBody, o?: CommandOptions) =>
      c.json(`/orders/${id}/items/${itemId}/cancel`, OrderSchema, {
        method: POST,
        body,
        ...extras(o),
      }),
    /** Sends every PENDING item to the kitchen: one KOT per station. */
    fire: (id: string, o?: CommandOptions) =>
      c.json(`/orders/${id}/kots`, FireKotsResponseSchema, { method: POST, ...extras(o) }),
    cancel: (id: string, body: CancelOrderBody, o?: CommandOptions) =>
      c.json(`/orders/${id}/cancel`, OrderSchema, { method: POST, body, ...extras(o) }),
  },
  kitchen: {
    /** Active KOTs (NEW → READY); all stations when `stationId` is null. */
    kots: (stationId: string | null) =>
      c.json('/kitchen/kots', KotsResponseSchema, {
        query: { station: stationId ?? undefined },
      }),
    setStatus: (id: string, to: KotTarget, version: number) =>
      c.json(`/kitchen/kots/${id}/status`, KotSchema, { method: POST, body: { to, version } }),
    bumpItem: (id: string, itemId: string) =>
      c.json(`/kitchen/kots/${id}/items/${itemId}/ready`, KotSchema, { method: POST }),
    assign: (id: string, chefId: string | null, version: number) =>
      c.json(`/kitchen/kots/${id}/assign`, KotSchema, { method: POST, body: { chefId, version } }),
    chefs: () => c.json('/kitchen/chefs', ChefsResponseSchema),
    metrics: () => c.json('/kitchen/metrics', KitchenMetricsSchema),
  },
  tokens: {
    /** Public: the token display TV works without anyone signed in. */
    board: () => c.json('/tokens', TokenBoardSchema, { auth: false }),
  },
  hub: {
    info: () => c.json('/hub/info', HubInfoSchema, { auth: false }),
  },
  devices: {
    me: () => c.json('/devices/me', DeviceSchema, { auth: false }),
    pair: (body: { code: string; fingerprint: string; platform?: DevicePlatform }) =>
      c.json('/devices/pair', PairDeviceResponseSchema, { method: POST, body, auth: false }),
    createPairingCode: (body: { name: string; kind: DeviceKind }) =>
      c.json('/devices/pairing-codes', PairingCodeResponseSchema, { method: POST, body }),
    list: () => c.json('/devices', DevicesResponseSchema),
    update: (id: string, body: UpdateDeviceBody) =>
      c.json(`/devices/${id}`, DeviceSchema, { method: PATCH, body }),
  },
  peripherals: {
    list: () => c.json('/peripherals', PeripheralsResponseSchema),
    create: (body: SavePeripheralBody) =>
      c.json('/peripherals', PeripheralSchema, { method: POST, body }),
    update: (id: string, body: SavePeripheralBody) =>
      c.json(`/peripherals/${id}`, PeripheralSchema, { method: PATCH, body }),
  },
};
