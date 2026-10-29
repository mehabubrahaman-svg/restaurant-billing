// Purchase (Phase 3) and Accounts (Phase 4).
import {
  AccountSchema,
  AccountsResponseSchema,
  BalanceSheetSchema,
  CashFlowSchema,
  ExpenseSchema,
  ExpensesResponseSchema,
  GrnSchema,
  GrnsResponseSchema,
  GstSummarySchema,
  JournalEntriesResponseSchema,
  JournalEntrySchema,
  LedgerSchema,
  PartyLedgerSchema,
  ProfitAndLossSchema,
  PurchaseOrderSchema,
  PurchaseOrdersResponseSchema,
  TrialBalanceSchema,
  VendorDuesReportSchema,
  VendorPaymentSchema,
  VendorPaymentsResponseSchema,
  VendorSchema,
  VendorStatementSchema,
  VendorsResponseSchema,
  type AccountType,
  type JournalSourceType,
  type PostJournalRequest,
  type PurchaseOrderStatus,
  type SaveGrnRequest,
  type SavePurchaseOrderRequest,
  type SaveVendorRequest,
  type VendorPaymentMethod,
} from '@restroos/contracts';
import {
  API_PREFIX,
  AddonGroupSchema,
  AddonGroupsResponseSchema,
  ApproveResponseSchema,
  AuditLogPageSchema,
  AuditVerifyResponseSchema,
  BillPreviewResponseSchema,
  CouponSchema,
  CouponsResponseSchema,
  BACKUP_PASSPHRASE_HEADER,
  BackupSchema,
  BackupsResponseSchema,
  CustomerDetailSchema,
  CustomerSchema,
  CustomersResponseSchema,
  LoyaltyLedgerSchema,
  MembershipTierSchema,
  MembershipTiersResponseSchema,
  type AdjustLoyaltyRequest,
  ReservationSchema,
  SalesReportSchema,
  QrMenuSchema,
  QrRequestStatusResponseSchema,
  QrRequestsResponseSchema,
  type SubmitQrRequest,
  ReportFileSchema,
  ReportFilesResponseSchema,
  ReportScheduleSchema,
  ReportSchedulesResponseSchema,
  type SaveReportScheduleRequest,
  Gstr1Schema,
  Gstr3bSchema,
  VatRegisterSchema,
  type SalesReportQuery,
  ReservationsResponseSchema,
  type SaveReservationRequest,
  type UpdateReservationRequest,
  DashboardSchema,
  DayEndReportSchema,
  KotPrintResponseSchema,
  PrintDocumentSchema,
  PrintOutcomeSchema,
  RestoreBackupResponseSchema,
  SalesChannelSchema,
  SalesChannelsResponseSchema,
  BillResponseSchema,
  BranchSettingsSchema,
  InvoiceSchema,
  InvoicesResponseSchema,
  RefundResponseSchema,
  ShiftReportSchema,
  type BillRequest,
  type InvoiceStatus,
  type PaymentMethod,
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
  AddonIngredientsSchema,
  ConsumptionReportSchema,
  InventoryItemSchema,
  InventoryItemsResponseSchema,
  RecipeSchema,
  RecipesResponseSchema,
  StockAlertsSchema,
  StockCountSchema,
  StockCountsResponseSchema,
  StockEntryResponseSchema,
  StockMovementsResponseSchema,
  UnitsResponseSchema,
  type MovementType,
  type SaveInventoryItemRequest,
  type SaveRecipeRequest,
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

// ---- Purchase and Accounts request bodies ----------------------------------------------
/** PATCH /vendors/{id}: any vendor field; `isActive: false` retires the vendor. */
export type UpdateVendorBody = Partial<SaveVendorRequest> & { version: number; isActive?: boolean };
export type GrnStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';
/** Only a DRAFT purchase order can be edited; `lines` replaces them all. */
export interface UpdatePurchaseOrderBody {
  version: number;
  vendorId?: string;
  expectedOn?: string | null;
  notes?: string | null;
  lines?: SavePurchaseOrderRequest['lines'];
}
/** Only a DRAFT GRN can be edited; `lines` replaces them all. */
export interface UpdateGrnBody {
  version: number;
  vendorInvoiceNo?: string | null;
  vendorInvoiceDate?: string | null;
  notes?: string | null;
  lines?: SaveGrnRequest['lines'];
}
/** Against one posted GRN, or on account (`grnId: null`: settles the oldest bills first). */
export interface VendorPaymentBody {
  vendorId: string;
  grnId: string | null;
  method: VendorPaymentMethod;
  /** Paise. */
  amount: number;
  reference: string | null;
  /** YYYY-MM-DD, not in the future; the business day when left out. */
  paidOn?: string;
}
export interface SaveAccountBody {
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
}
/** System accounts can be renamed but not retired or retyped. */
export interface UpdateAccountBody {
  version: number;
  name?: string;
  type?: AccountType;
  parentId?: string | null;
  isActive?: boolean;
}
export interface JournalFilter {
  from?: string;
  to?: string;
  sourceType?: JournalSourceType;
  accountId?: string;
  /** The `nextCursor` of the page before. */
  before?: string;
  limit?: number;
}
/** An expense account paid from cash or the bank; `amount` includes the GST in `taxAmount`. */
export interface ExpenseBody {
  expenseAccountId: string;
  paidFromAccountId: string;
  amount: number;
  taxAmount: number;
  description: string;
  reference: string | null;
  expenseDate?: string;
}
export type LedgerPartyType = 'CUSTOMER' | 'VENDOR';

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

/** One entry of POST /invoices/{id}/payments (split payment = several). Amounts in paise. */
export interface NewPaymentBody {
  method: PaymentMethod;
  amount: number;
  tendered?: number;
  reference?: string;
  cardLast4?: string;
  terminalLabel?: string;
}
export type RefundMethod = Exclude<PaymentMethod, 'CREDIT' | 'AGGREGATOR'>;
export interface RefundBody {
  lines?: { invoiceLineId: string; quantity: number }[];
  amount?: number;
  method: RefundMethod;
  reference?: string;
  reason: string;
}
export interface UpdateReportScheduleBody {
  frequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  format?: 'XLSX' | 'CSV';
  isActive?: boolean;
  version: number;
}
export interface SaveMembershipTierBody {
  name?: string;
  /** Lifetime spend needed, in paise. */
  minSpend?: number;
  minVisits?: number;
  /** 10000 = points at the normal rate. */
  pointsMultiplierBp?: number;
  discountBp?: number;
  isActive?: boolean;
}
export interface UpdateCustomerBody {
  /** A tier given by hand; null lets it follow spend and visits. */
  membershipTierId?: string | null;
  version: number;
}
export interface SaveCouponBody {
  code?: string;
  kind?: 'PERCENT' | 'FIXED';
  /** Basis points or paise. */
  value?: number;
  maxDiscount?: number | null;
  minBill?: number;
  validFrom?: string | null;
  validTo?: string | null;
  usageLimit?: number | null;
}
export interface CloseShiftBody {
  version: number;
  countedCash: number;
  /** Rupee value of the note/coin → count. */
  denominations?: Record<string, number>;
  tenders: { method: PaymentMethod; terminalLabel: string; reportedAmount: number }[];
  notes?: string;
}
export type KotTarget = 'ACCEPTED' | 'COOKING' | 'READY' | 'SERVED';
export interface SaveSalesChannelBody {
  code?: string;
  name?: string;
  kind?: 'AGGREGATOR' | 'OWN_ONLINE';
  /** Basis points (2200 = 22%). */
  commissionBp?: number;
  priceMarkupBp?: number;
  gstPaidByOperator?: boolean;
  /** For GSTR-1 table 14; null clears it. */
  operatorGstin?: string | null;
  isActive?: boolean;
  version?: number;
}
/** POST /orders/aggregator: a Swiggy/Zomato order keyed in from the partner's tablet. */
export interface AggregatorOrderBody {
  salesChannelId: string;
  externalOrderId: string;
  externalOtp?: string;
  notes?: string;
  items: NewOrderItem[];
  fire?: boolean;
}

/** PATCH /inventory-items/{id}: any fields of the save body; `isActive: false` retires. */
export type UpdateInventoryItemBody = Partial<SaveInventoryItemRequest> & {
  version: number;
  isActive?: boolean;
};
export interface UpdateRecipeBody {
  version: number;
  yieldPortions?: number;
  ingredients?: SaveRecipeRequest['ingredients'];
}
/** One received line (purchase or opening stock): quantity in milli base units, cost in paise. */
export interface ReceiptLineBody {
  inventoryItemId: string;
  qtyMilli: number;
  totalCost: number;
  batchNo?: string | null;
  expiresOn?: string | null;
}
export interface StockReceiptBody {
  lines: ReceiptLineBody[];
  reference?: string | null;
}
export interface OpeningStockBody {
  lines: ReceiptLineBody[];
}
/** Wastage takes positive quantities; an adjustment's are signed (+ adds, − removes). */
export interface StockIssueBody {
  lines: { inventoryItemId: string; qtyMilli: number }[];
  reason: string;
}
export interface StockMovementsFilter {
  inventoryItemId?: string;
  type?: MovementType;
  from?: string;
  to?: string;
  before?: string;
  limit?: number;
}
export type StockCountType = 'OPENING' | 'CLOSING' | 'SPOT';
export interface SaveCountLinesBody {
  version: number;
  /** `null` clears an item's count. */
  lines: { inventoryItemId: string; countedQtyMilli: number | null }[];
}
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

/** `{ data: Invoice[] }`: an order's invoices, or an invoice's credit notes. */
const InvoiceListSchema = {
  parse(input: unknown) {
    const data = (input as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) throw new Error('not an invoice list');
    return { data: data.map((i) => InvoiceSchema.parse(i)) };
  },
};

export const api = {
  /** Phase 3: vendors, purchase orders, goods received notes, vendor payments, dues. */
  purchasing: {
    /** Units for PO and GRN lines; a line's unit must measure its item's base unit. */
    units: () => c.json('/units', UnitsResponseSchema),
    /** Active stock items with their base and purchase units. */
    items: () => c.json('/inventory-items', InventoryItemsResponseSchema),
    vendors: (includeRetired = false) =>
      c.json('/vendors', VendorsResponseSchema, { query: { includeRetired } }),
    vendor: (id: string) => c.json(`/vendors/${id}`, VendorSchema),
    createVendor: (body: SaveVendorRequest) =>
      c.json('/vendors', VendorSchema, { method: POST, body }),
    updateVendor: (id: string, body: UpdateVendorBody) =>
      c.json(`/vendors/${id}`, VendorSchema, { method: PATCH, body }),
    /** Bills and payments between two days (at most 366), with running balances. */
    statement: (id: string, from: string, to: string) =>
      c.json(`/vendors/${id}/statement`, VendorStatementSchema, { query: { from, to } }),
    orders: (status?: PurchaseOrderStatus, vendorId?: string) =>
      c.json('/purchase-orders', PurchaseOrdersResponseSchema, { query: { status, vendorId } }),
    order: (id: string) => c.json(`/purchase-orders/${id}`, PurchaseOrderSchema),
    createOrder: (body: SavePurchaseOrderRequest) =>
      c.json('/purchase-orders', PurchaseOrderSchema, { method: POST, body }),
    updateOrder: (id: string, body: UpdatePurchaseOrderBody) =>
      c.json(`/purchase-orders/${id}`, PurchaseOrderSchema, { method: PATCH, body }),
    /** approve (po.approve), send or close (po.create): the order's next step. */
    moveOrder: (id: string, step: 'approve' | 'send' | 'close', version: number) =>
      c.json(`/purchase-orders/${id}/${step}`, PurchaseOrderSchema, {
        method: POST,
        body: { version },
      }),
    cancelOrder: (id: string, version: number, reason: string) =>
      c.json(`/purchase-orders/${id}/cancel`, PurchaseOrderSchema, {
        method: POST,
        body: { version, reason },
      }),
    grns: (filter: { status?: GrnStatus; vendorId?: string; purchaseOrderId?: string } = {}) =>
      c.json('/grns', GrnsResponseSchema, {
        query: {
          status: filter.status,
          vendorId: filter.vendorId,
          purchaseOrderId: filter.purchaseOrderId,
        },
      }),
    grn: (id: string) => c.json(`/grns/${id}`, GrnSchema),
    createGrn: (body: SaveGrnRequest) => c.json('/grns', GrnSchema, { method: POST, body }),
    updateGrn: (id: string, body: UpdateGrnBody) =>
      c.json(`/grns/${id}`, GrnSchema, { method: PATCH, body }),
    /** Puts the accepted goods into stock and the bill into the vendor's dues. */
    postGrn: (id: string, version: number) =>
      c.json(`/grns/${id}/post`, GrnSchema, { method: POST, body: { version } }),
    cancelGrn: (id: string, version: number, reason: string) =>
      c.json(`/grns/${id}/cancel`, GrnSchema, { method: POST, body: { version, reason } }),
    payments: (filter: { vendorId?: string; from?: string; to?: string } = {}) =>
      c.json('/vendor-payments', VendorPaymentsResponseSchema, {
        query: { vendorId: filter.vendorId, from: filter.from, to: filter.to },
      }),
    recordPayment: (body: VendorPaymentBody, o?: CommandOptions) =>
      c.json('/vendor-payments', VendorPaymentSchema, { method: POST, body, ...extras(o) }),
    /** What is owed per vendor by age, as of a day (today's business day when left out). */
    dues: (asOf?: string) =>
      c.json('/reports/vendor-dues', VendorDuesReportSchema, { query: { asOf } }),
  },
  /** Phase 4: chart of accounts, journals, expenses, ledgers and financial statements. */
  accounting: {
    accounts: () => c.json('/accounts', AccountsResponseSchema),
    createAccount: (body: SaveAccountBody) =>
      c.json('/accounts', AccountSchema, { method: POST, body }),
    /** Seeded account ids look like "<organisation>:1000", so they are encoded. */
    updateAccount: (id: string, body: UpdateAccountBody) =>
      c.json(`/accounts/${encodeURIComponent(id)}`, AccountSchema, { method: PATCH, body }),
    /** Newest first; pass the page's `nextCursor` as `before` for older entries. */
    journal: (filter: JournalFilter) =>
      c.json('/journal-entries', JournalEntriesResponseSchema, {
        query: {
          from: filter.from,
          to: filter.to,
          sourceType: filter.sourceType,
          accountId: filter.accountId,
          before: filter.before,
          limit: filter.limit,
        },
      }),
    entry: (id: string) => c.json(`/journal-entries/${id}`, JournalEntrySchema),
    postJournal: (body: PostJournalRequest, o?: CommandOptions) =>
      c.json('/journal-entries', JournalEntrySchema, { method: POST, body, ...extras(o) }),
    /** Manual entries only; answers the reversing entry. */
    reverse: (id: string, reason: string, entryDate?: string) =>
      c.json(`/journal-entries/${id}/reverse`, JournalEntrySchema, {
        method: POST,
        body: entryDate === undefined ? { reason } : { reason, entryDate },
      }),
    expenses: (from?: string, to?: string) =>
      c.json('/expenses', ExpensesResponseSchema, { query: { from, to } }),
    recordExpense: (body: ExpenseBody, o?: CommandOptions) =>
      c.json('/expenses', ExpenseSchema, { method: POST, body, ...extras(o) }),
    cancelExpense: (id: string, version: number, reason: string) =>
      c.json(`/expenses/${id}/cancel`, ExpenseSchema, { method: POST, body: { version, reason } }),
    ledger: (accountId: string, from: string, to: string) =>
      c.json(`/ledgers/${encodeURIComponent(accountId)}`, LedgerSchema, { query: { from, to } }),
    partyLedger: (type: LedgerPartyType, id: string, from: string, to: string) =>
      c.json(`/ledgers/party/${type}/${encodeURIComponent(id)}`, PartyLedgerSchema, {
        query: { from, to },
      }),
    trialBalance: (asOf?: string) =>
      c.json('/reports/trial-balance', TrialBalanceSchema, { query: { asOf } }),
    profitAndLoss: (from: string, to: string) =>
      c.json('/reports/profit-and-loss', ProfitAndLossSchema, { query: { from, to } }),
    balanceSheet: (asOf?: string) =>
      c.json('/reports/balance-sheet', BalanceSheetSchema, { query: { asOf } }),
    cashFlow: (from: string, to: string) =>
      c.json('/reports/cash-flow', CashFlowSchema, { query: { from, to } }),
    gstSummary: (from: string, to: string) =>
      c.json('/reports/gst-summary', GstSummarySchema, { query: { from, to } }),
  },
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
    test: (id: string) =>
      c.json(`/printers/${id}/test`, PrintOutcomeSchema, { method: POST, body: {} }),
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
  reservations: {
    /** Bookings whose time falls in [from, to] (ISO instants); the Hub defaults to the next 30 days. */
    list: (from?: string, to?: string) =>
      c.json('/reservations', ReservationsResponseSchema, { query: { from, to } }),
    create: (body: SaveReservationRequest) =>
      c.json('/reservations', ReservationSchema, { method: POST, body }),
    update: (id: string, body: UpdateReservationRequest) =>
      c.json(`/reservations/${id}`, ReservationSchema, { method: PATCH, body }),
    /** SEATED, CANCELLED or NO_SHOW. */
    close: (id: string, action: 'seat' | 'cancel' | 'no-show', version: number) =>
      c.json(`/reservations/${id}/${action}`, ReservationSchema, {
        method: POST,
        body: { version },
      }),
  },
  orders: {
    open: (body: OpenOrderRequest, o?: CommandOptions) =>
      c.json('/orders', OrderSchema, { method: POST, body, ...extras(o) }),
    listOpen: () => c.json('/orders', OrdersResponseSchema, { query: { status: 'OPEN' } }),
    /** Billed and waiting for payment (the POS counter lists these too). */
    listBilled: () => c.json('/orders', OrdersResponseSchema, { query: { status: 'BILLED' } }),
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
    /** A delivery order with its items, fired to the kitchen at once. */
    aggregator: (body: AggregatorOrderBody, o?: CommandOptions) =>
      c.json('/orders/aggregator', FireKotsResponseSchema, { method: POST, body, ...extras(o) }),
  },
  salesChannels: {
    list: () => c.json('/sales-channels', SalesChannelsResponseSchema),
    create: (body: SaveSalesChannelBody) =>
      c.json('/sales-channels', SalesChannelSchema, { method: POST, body }),
    update: (id: string, body: SaveSalesChannelBody & { version: number }) =>
      c.json(`/sales-channels/${id}`, SalesChannelSchema, { method: PATCH, body }),
  },
  customers: {
    /** By mobile number or name; an empty query finds nobody. */
    search: (q: string, signal?: AbortSignal) =>
      c.json('/customers', CustomersResponseSchema, {
        query: { q },
        ...(signal === undefined ? {} : { signal }),
      }),
    get: (id: string) => c.json(`/customers/${id}`, CustomerDetailSchema),
    update: (id: string, body: UpdateCustomerBody) =>
      c.json(`/customers/${id}`, CustomerSchema, { method: PATCH, body }),
    /** The points balance and latest entries. */
    loyalty: (id: string) => c.json(`/customers/${id}/loyalty`, LoyaltyLedgerSchema),
    adjustLoyalty: (id: string, body: AdjustLoyaltyRequest) =>
      c.json(`/customers/${id}/loyalty`, LoyaltyLedgerSchema, { method: POST, body }),
  },
  /** The guest's phone after scanning a table's QR code: no sign-in. */
  qr: {
    menu: (token: string) =>
      c.json(`/public/qr/${encodeURIComponent(token)}/menu`, QrMenuSchema, { auth: false }),
    submit: (token: string, body: SubmitQrRequest) =>
      c.json(`/public/qr/${encodeURIComponent(token)}/requests`, QrRequestStatusResponseSchema, {
        method: POST,
        body,
        auth: false,
      }),
    status: (token: string, id: string) =>
      c.json(
        `/public/qr/${encodeURIComponent(token)}/requests/${id}`,
        QrRequestStatusResponseSchema,
        { auth: false },
      ),
  },
  /** Guests' QR orders and calls, waiting for a captain. */
  qrRequests: {
    list: () => c.json('/qr-requests', QrRequestsResponseSchema),
    accept: (id: string, fire: boolean) =>
      c.json(`/qr-requests/${id}/accept`, FireKotsResponseSchema, {
        method: POST,
        body: { fire },
      }),
    reject: (id: string, reason: string) =>
      c.json(`/qr-requests/${id}/reject`, QrRequestStatusResponseSchema, {
        method: POST,
        body: { reason },
      }),
    done: (id: string) =>
      c.json(`/qr-requests/${id}/done`, QrRequestStatusResponseSchema, { method: POST }),
  },
  reportSchedules: {
    list: () => c.json('/report-schedules', ReportSchedulesResponseSchema),
    create: (body: SaveReportScheduleRequest) =>
      c.json('/report-schedules', ReportScheduleSchema, { method: POST, body }),
    update: (id: string, body: UpdateReportScheduleBody) =>
      c.json(`/report-schedules/${id}`, ReportScheduleSchema, { method: PATCH, body }),
    /** "Make now": the file for the last whole period. */
    run: (id: string) => c.json(`/report-schedules/${id}/run`, ReportFileSchema, { method: POST }),
  },
  reportFiles: {
    list: () => c.json('/report-files', ReportFilesResponseSchema),
    download: (id: string) => c.blob(`/report-files/${id}/download`),
  },
  membershipTiers: {
    list: () => c.json('/membership-tiers', MembershipTiersResponseSchema),
    create: (body: SaveMembershipTierBody) =>
      c.json('/membership-tiers', MembershipTierSchema, { method: POST, body }),
    update: (id: string, body: SaveMembershipTierBody & { version: number }) =>
      c.json(`/membership-tiers/${id}`, MembershipTierSchema, { method: PATCH, body }),
  },
  reports: {
    /** The business day's report; today's business date when `date` is left out. */
    dayEnd: (date?: string) => c.json('/reports/day-end', DayEndReportSchema, { query: { date } }),
    printDayEnd: (date: string, printerId?: string) =>
      c.json('/reports/day-end/print', PrintOutcomeSchema, {
        method: POST,
        query: { date },
        body: printerId === undefined ? {} : { printerId },
      }),
    dayEndCsv: (date: string) => c.blob('/reports/day-end.csv', { query: { date } }),
    /** Every invoice and credit note of the range (at most 366 days). */
    salesRegisterCsv: (from: string, to: string) =>
      c.blob('/reports/sales-register.csv', { query: { from, to } }),
    salesRegisterXlsx: (from: string, to: string) =>
      c.blob('/reports/sales-register.xlsx', { query: { from, to } }),
    /** The report engine: any range up to 5 years, by day, week, month or financial year. */
    sales: (query: SalesReportQuery) =>
      c.json('/reports/sales', SalesReportSchema, { query: { ...query } }),
    salesFile: (query: SalesReportQuery, format: 'xlsx' | 'csv') =>
      c.blob(`/reports/sales.${format}`, { query: { ...query } }),
    /** GST returns and the liquor VAT register for a period of up to 366 days. */
    gstr1: (from: string, to: string) =>
      c.json('/reports/gstr1', Gstr1Schema, { query: { from, to } }),
    gstr3b: (from: string, to: string) =>
      c.json('/reports/gstr3b', Gstr3bSchema, { query: { from, to } }),
    vatRegister: (from: string, to: string) =>
      c.json('/reports/vat-register', VatRegisterSchema, { query: { from, to } }),
    /** `gstr1`, `gstr3b` or `vat-register` as .xlsx/.csv, or one GSTR-1 section (`gstr1/b2cs`) as .csv. */
    returnFile: (name: string, format: 'xlsx' | 'csv', from: string, to: string) =>
      c.blob(`/reports/${name}.${format}`, { query: { from, to } }),
    dashboard: () => c.json('/reports/dashboard', DashboardSchema),
    /** Recipe (theoretical) against counted consumption per item, for 1 to 366 days. */
    consumption: (from: string, to: string) =>
      c.json('/reports/consumption', ConsumptionReportSchema, { query: { from, to } }),
  },
  inventory: {
    units: () => c.json('/units', UnitsResponseSchema),
    items: (includeRetired = false) =>
      c.json('/inventory-items', InventoryItemsResponseSchema, {
        query: { includeRetired: includeRetired ? 'true' : undefined },
      }),
    item: (id: string) => c.json(`/inventory-items/${id}`, InventoryItemSchema),
    createItem: (body: SaveInventoryItemRequest) =>
      c.json('/inventory-items', InventoryItemSchema, { method: POST, body }),
    updateItem: (id: string, body: UpdateInventoryItemBody) =>
      c.json(`/inventory-items/${id}`, InventoryItemSchema, { method: PATCH, body }),
    /** A dish's recipes: its own (variantId null) and any per size. */
    recipes: (menuItemId: string) =>
      c.json('/recipes', RecipesResponseSchema, { query: { menuItemId } }),
    createRecipe: (body: SaveRecipeRequest) =>
      c.json('/recipes', RecipeSchema, { method: POST, body }),
    updateRecipe: (id: string, body: UpdateRecipeBody) =>
      c.json(`/recipes/${id}`, RecipeSchema, { method: PATCH, body }),
    /** The dish (or size) stops taking stock; the Hub answers 204. */
    removeRecipe: (id: string, version: number) =>
      c.void(`/recipes/${id}`, { method: PATCH, body: { version, isActive: false } }),
    addonIngredients: (addonId: string) =>
      c.json(`/addons/${addonId}/ingredients`, AddonIngredientsSchema),
    /** The full list: ingredients left out are removed. */
    setAddonIngredients: (
      addonId: string,
      ingredients: { inventoryItemId: string; qtyMilli: number }[],
    ) =>
      c.json(`/addons/${addonId}/ingredients`, AddonIngredientsSchema, {
        method: PUT,
        body: { ingredients },
      }),
    /** Bought directly (the market, a local shop), without a purchase order. */
    receive: (body: StockReceiptBody, o?: CommandOptions) =>
      c.json('/stock/receipts', StockEntryResponseSchema, { method: POST, body, ...extras(o) }),
    /** What was on the shelves on day one: once per item, before it is first received. */
    opening: (body: OpeningStockBody, o?: CommandOptions) =>
      c.json('/stock/opening', StockEntryResponseSchema, { method: POST, body, ...extras(o) }),
    wastage: (body: StockIssueBody, o?: CommandOptions) =>
      c.json('/stock/wastage', StockEntryResponseSchema, { method: POST, body, ...extras(o) }),
    adjust: (body: StockIssueBody, o?: CommandOptions) =>
      c.json('/stock/adjustments', StockEntryResponseSchema, { method: POST, body, ...extras(o) }),
    /** Newest first; pass the page's `nextCursor` as `before` for older ones. */
    movements: (filter: StockMovementsFilter) =>
      c.json('/stock/movements', StockMovementsResponseSchema, { query: { ...filter } }),
    alerts: () => c.json('/stock/alerts', StockAlertsSchema),
    counts: () => c.json('/stock-counts', StockCountsResponseSchema),
    count: (id: string) => c.json(`/stock-counts/${id}`, StockCountSchema),
    createCount: (body: { countType: StockCountType; notes?: string | null }) =>
      c.json('/stock-counts', StockCountSchema, { method: POST, body }),
    saveCountLines: (id: string, body: SaveCountLinesBody) =>
      c.json(`/stock-counts/${id}/lines`, StockCountSchema, { method: PUT, body }),
    /** Books every difference as an adjustment; the count can't change afterwards. */
    postCount: (id: string, version: number) =>
      c.json(`/stock-counts/${id}/post`, StockCountSchema, { method: POST, body: { version } }),
  },
  backups: {
    list: () => c.json('/backups', BackupsResponseSchema),
    create: () => c.json('/backups', BackupSchema, { method: POST, body: {} }),
    download: (id: string) => c.blob(`/backups/${id}/download`),
    /** A .rbak file from another PC or a USB drive, with the passphrase it was made with. */
    import: (file: Blob, passphrase: string) =>
      c.json('/backups/import', BackupSchema, {
        method: POST,
        rawBody: file,
        headers: { [BACKUP_PASSPHRASE_HEADER]: passphrase },
      }),
    /** Replaces every record on the Hub; it restarts right after answering. */
    restore: (id: string, passphrase?: string) =>
      c.json(`/backups/${id}/restore`, RestoreBackupResponseSchema, {
        method: POST,
        body: { confirm: 'RESTORE', ...(passphrase === undefined ? {} : { passphrase }) },
      }),
  },
  billing: {
    /** What the bill would be; nothing is saved. Two drafts when liquor is billed separately. */
    preview: (orderId: string, body: BillRequest, signal?: AbortSignal) =>
      c.json(`/orders/${orderId}/bill-preview`, BillPreviewResponseSchema, {
        method: POST,
        body,
        ...(signal === undefined ? {} : { signal }),
      }),
    /** Issues the invoice(s): the order becomes BILLED. */
    bill: (orderId: string, body: BillRequest, o?: CommandOptions) =>
      c.json(`/orders/${orderId}/invoice`, BillResponseSchema, {
        method: POST,
        body,
        ...extras(o),
      }),
    orderInvoices: (orderId: string) => c.json(`/orders/${orderId}/invoices`, InvoiceListSchema),
    /** Credit notes issued against one invoice (refunds), oldest first. */
    creditNotes: (id: string) => c.json(`/invoices/${id}/credit-notes`, InvoiceListSchema),
    list: (date: string, status?: InvoiceStatus) =>
      c.json('/invoices', InvoicesResponseSchema, { query: { date, status } }),
    get: (id: string) => c.json(`/invoices/${id}`, InvoiceSchema),
    pay: (id: string, payments: NewPaymentBody[], o?: CommandOptions) =>
      c.json(`/invoices/${id}/payments`, InvoiceSchema, {
        method: POST,
        body: { payments },
        ...extras(o),
      }),
    cancel: (id: string, body: { version: number; reason: string }, o?: CommandOptions) =>
      c.json(`/invoices/${id}/cancel`, InvoiceSchema, { method: POST, body, ...extras(o) }),
    refund: (id: string, body: RefundBody, o?: CommandOptions) =>
      c.json(`/invoices/${id}/refunds`, RefundResponseSchema, { method: POST, body, ...extras(o) }),
    /** The first print is the original; later ones say DUPLICATE (billing.reprint). */
    print: (id: string, o?: CommandOptions) =>
      c.json(`/invoices/${id}/print`, PrintOutcomeSchema, { method: POST, body: {}, ...extras(o) }),
    /** The slip as blocks, for the on-screen preview and browser printing. */
    receipt: (id: string) => c.json(`/invoices/${id}/receipt`, PrintDocumentSchema),
  },
  coupons: {
    list: () => c.json('/coupons', CouponsResponseSchema),
    create: (body: SaveCouponBody) => c.json('/coupons', CouponSchema, { method: POST, body }),
    update: (id: string, body: SaveCouponBody & { version: number; isActive?: boolean }) =>
      c.json(`/coupons/${id}`, CouponSchema, { method: PATCH, body }),
  },
  cashShifts: {
    open: (openingFloat: number, o?: CommandOptions) =>
      c.json('/cash-shifts', ShiftReportSchema, {
        method: POST,
        body: { openingFloat },
        ...extras(o),
      }),
    /** The shift open on this device; 404 NOT_FOUND when there is none. */
    current: () => c.json('/cash-shifts/current', ShiftReportSchema),
    /** X report while open, Z report once closed. */
    get: (id: string) => c.json(`/cash-shifts/${id}`, ShiftReportSchema),
    close: (id: string, body: CloseShiftBody, o?: CommandOptions) =>
      c.json(`/cash-shifts/${id}/close`, ShiftReportSchema, { method: POST, body, ...extras(o) }),
    /** Prints the X (open) or Z (closed) report on the report printer. */
    print: (id: string) =>
      c.json(`/cash-shifts/${id}/print`, PrintOutcomeSchema, { method: POST, body: {} }),
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
    /** Prints the KOT again on its station's printer(s), marked REPRINT. */
    reprint: (id: string) =>
      c.json(`/kitchen/kots/${id}/reprint`, KotPrintResponseSchema, { method: POST, body: {} }),
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
