import {
  AccountingProjector,
  AccountingService,
  AuthService,
  BillingService,
  CatalogService,
  CouponService,
  CustomerService,
  ReservationService,
  LoyaltyService,
  MembershipService,
  InventoryProjector,
  InventoryService,
  PurchasingService,
  PrintService,
  SalesChannelService,
  type RasterRenderer,
  ShiftService,
  type BillingQueries,
  type ReportQueries,
  type GstReturnQueries,
  BackupService,
  type HubLifecycle,
  DeviceService,
  FloorService,
  KitchenService,
  OrderService,
  type BusinessCalendar,
  type KitchenQueries,
  type OrderQueries,
  type PrinterTransport,
  MenuImporter,
  QrOrderingService,
  RelayIntegrationService,
  ReportScheduleService,
  RoleAdminService,
  SettingsService,
  SetupService,
  UserAdminService,
  type AuditQueries,
  type Clock,
  type EventBus,
  type IdempotencyStore,
  type IdentityQueries,
  type IdGenerator,
  type PasswordHasher,
  type RefreshTokenStore,
  type RoleRepository,
  type UnitOfWork,
  type UserRepository,
} from '@restroos/application';
import {
  BcryptPasswordHasher,
  InProcessEventBus,
  JoseTokenSigner,
  nodeTokenCodec,
  ScryptKeyDerivation,
  SqliteAccountingQueries,
  SqliteAccountingRepository,
  SqliteAuditQueries,
  SqlitePostingSources,
  SqliteBillingQueries,
  SqliteReportQueries,
  SqliteGstQueries,
  SqliteQrRequestRepository,
  SqliteRelayRepository,
  FileReportStore,
  SqliteReportFileRepository,
  SqliteReportScheduleRepository,
  writeXlsx,
  FileBackupStore,
  SqliteBackupRepository,
  SqliteCouponRepository,
  SqliteCustomerRepository,
  SqliteReservationRepository,
  SqliteLoyaltyRepository,
  SqliteMembershipTierRepository,
  SqliteInventoryQueries,
  SqliteInventoryRepository,
  SqliteMenuLookup,
  SqliteProjectionLog,
  SqlitePurchasingQueries,
  SqlitePurchasingRepository,
  SqliteInvoiceRepository,
  SqliteShiftRepository,
  SqliteSalesChannelRepository,
  escPos,
  hubPrinterTransport,
  SqliteBusinessCalendar,
  SqliteKitchenQueries,
  SqliteKotRepository,
  SqliteOrderQueries,
  SqliteOrderRepository,
  SqliteCatalogRepository,
  SqliteDeviceRepository,
  SqliteFloorRepository,
  SqliteIdempotencyStore,
  SqliteIdentityQueries,
  SqliteInstallationRepository,
  SqliteReferenceData,
  SqliteRefreshTokenStore,
  SqliteRoleRepository,
  SqliteSecretStore,
  SqliteSettingsRepository,
  SqliteUnitOfWork,
  SqliteUserRepository,
  systemClock,
  uuidv7Generator,
  type SqliteDatabase,
} from '@restroos/infrastructure';
import { RelayClient } from './relay/relay-client';
import { asFunction, asValue, createContainer, type AwilixContainer } from 'awilix';
import type { Logger } from 'pino';
import { randomInt } from 'node:crypto';
import type { ServerConfig } from './config';
import { hubNetwork, type HubNetwork } from './hub-network';
import { findFontsDir, rasterRenderer } from './printing';

/** Everything the HTTP layer may resolve. */
export interface Cradle {
  config: ServerConfig;
  logger: Logger;
  db: SqliteDatabase;
  clock: Clock;
  ids: IdGenerator;
  startedAt: Date;
  eventBus: EventBus;
  unitOfWork: UnitOfWork;
  idempotencyStore: IdempotencyStore;
  hasher: PasswordHasher;
  users: UserRepository;
  roles: RoleRepository;
  identityQueries: IdentityQueries;
  refreshTokens: RefreshTokenStore;
  auditQueries: AuditQueries;
  authService: AuthService;
  userAdmin: UserAdminService;
  roleAdmin: RoleAdminService;
  setupService: SetupService;
  settingsService: SettingsService;
  catalogService: CatalogService;
  menuImporter: MenuImporter;
  floorService: FloorService;
  reservationService: ReservationService;
  loyaltyService: LoyaltyService;
  membershipService: MembershipService;
  deviceService: DeviceService;
  hubNetwork: HubNetwork;
  calendar: BusinessCalendar;
  orderQueries: OrderQueries;
  kitchenQueries: KitchenQueries;
  orderService: OrderService;
  qrOrderingService: QrOrderingService;
  relayIntegrationService: RelayIntegrationService;
  relayClient: RelayClient;
  kitchenService: KitchenService;
  billingQueries: BillingQueries;
  reportQueries: ReportQueries;
  gstQueries: GstReturnQueries;
  reportScheduleService: ReportScheduleService;
  billingService: BillingService;
  couponService: CouponService;
  shiftService: ShiftService;
  printService: PrintService;
  salesChannelService: SalesChannelService;
  customerService: CustomerService;
  backupService: BackupService;
  inventoryService: InventoryService;
  inventoryProjector: InventoryProjector;
  purchasingService: PurchasingService;
  accountingService: AccountingService;
  accountingProjector: AccountingProjector;
}

export interface ContainerOverrides {
  clock?: Clock;
  ids?: IdGenerator;
  /** Tests use a cheap bcrypt cost. */
  hasher?: PasswordHasher;
  /** Tests pass fixed LAN addresses and a pre-made certificate. */
  hubNetwork?: HubNetwork;
  /** Image renderer for Hindi/Bengali slips; tests pass null (English text only). */
  rasterRenderer?: RasterRenderer | null;
  printerTransport?: PrinterTransport;
  /** What a restore does to restart the Hub; main.ts shuts down and exits for the supervisor. */
  hubLifecycle?: HubLifecycle;
}

export function buildContainer(
  config: ServerConfig,
  logger: Logger,
  db: SqliteDatabase,
  overrides: ContainerOverrides = {},
): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>({ strict: true });
  const clock = overrides.clock ?? systemClock;
  const ids = overrides.ids ?? uuidv7Generator;
  const now = () => clock.now();
  const single = <T>(factory: (c: Cradle) => T) => asFunction(factory).singleton();

  container.register({
    config: asValue(config),
    logger: asValue(logger),
    db: asValue(db),
    clock: asValue(clock),
    ids: asValue(ids),
    startedAt: asValue(clock.now()),
    eventBus: single(({ logger }) => new InProcessEventBus(logger)),
    unitOfWork: single(
      ({ db, clock, ids, eventBus }) => new SqliteUnitOfWork({ db, clock, ids, eventBus }),
    ),
    idempotencyStore: single(({ db, clock }) => new SqliteIdempotencyStore(db, clock)),
    hasher: asValue(overrides.hasher ?? new BcryptPasswordHasher()),
    users: single(({ db }) => new SqliteUserRepository(db, now)),
    roles: single(({ db }) => new SqliteRoleRepository(db, now)),
    identityQueries: single(({ db }) => new SqliteIdentityQueries(db)),
    refreshTokens: single(({ db }) => new SqliteRefreshTokenStore(db)),
    auditQueries: single(({ db }) => new SqliteAuditQueries(db)),
    authService: single(
      (c) =>
        new AuthService({
          users: c.users,
          identity: c.identityQueries,
          refreshTokens: c.refreshTokens,
          tokens: nodeTokenCodec,
          signer: new JoseTokenSigner(new SqliteSecretStore(c.db, c.clock), c.clock, c.ids),
          hasher: c.hasher,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    userAdmin: single(
      (c) =>
        new UserAdminService({
          users: c.users,
          roles: c.roles,
          identity: c.identityQueries,
          refreshTokens: c.refreshTokens,
          hasher: c.hasher,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    roleAdmin: single(
      (c) =>
        new RoleAdminService({
          roles: c.roles,
          identity: c.identityQueries,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    setupService: single(
      (c) =>
        new SetupService({
          installation: new SqliteInstallationRepository(c.db),
          reference: new SqliteReferenceData(c.db),
          hasher: c.hasher,
          keys: new ScryptKeyDerivation(),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
          enabledWaves: c.config.rolloutWaves,
          timeZone: c.config.timeZone,
        }),
    ),
    settingsService: single(
      (c) =>
        new SettingsService({
          settings: new SqliteSettingsRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    catalogService: single(
      (c) =>
        new CatalogService({
          catalog: new SqliteCatalogRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    menuImporter: single(
      (c) =>
        new MenuImporter({
          catalog: new SqliteCatalogRepository(c.db),
          catalogService: c.catalogService,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    floorService: single(
      (c) =>
        new FloorService({
          floor: new SqliteFloorRepository(c.db),
          tokens: nodeTokenCodec,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    reservationService: single(
      (c) =>
        new ReservationService({
          reservations: new SqliteReservationRepository(c.db),
          floor: new SqliteFloorRepository(c.db),
          customerService: c.customerService,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    deviceService: single(
      (c) =>
        new DeviceService({
          devices: new SqliteDeviceRepository(c.db),
          tokens: nodeTokenCodec,
          refreshTokens: c.refreshTokens,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
          randomInt: (max) => randomInt(max),
        }),
    ),
    calendar: single(({ db }) => new SqliteBusinessCalendar(db)),
    orderQueries: single(({ db }) => new SqliteOrderQueries(db)),
    kitchenQueries: single(({ db }) => new SqliteKitchenQueries(db)),
    orderService: single(
      (c) =>
        new OrderService({
          orders: new SqliteOrderRepository(c.db, now),
          kots: new SqliteKotRepository(c.db, now),
          catalog: new SqliteCatalogRepository(c.db),
          floor: new SqliteFloorRepository(c.db),
          channels: new SqliteSalesChannelRepository(c.db),
          taxGroups: new SqliteSettingsRepository(c.db),
          calendar: c.calendar,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    qrOrderingService: single(
      (c) =>
        new QrOrderingService({
          requests: new SqliteQrRequestRepository(c.db),
          floor: new SqliteFloorRepository(c.db),
          catalog: new SqliteCatalogRepository(c.db),
          settings: new SqliteSettingsRepository(c.db),
          orders: c.orderService,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    relayIntegrationService: single(
      (c) =>
        new RelayIntegrationService({
          relay: new SqliteRelayRepository(c.db),
          orderService: c.orderService,
          orders: new SqliteOrderRepository(c.db, now),
          channels: new SqliteSalesChannelRepository(c.db),
          catalog: new SqliteCatalogRepository(c.db),
          settings: new SqliteSettingsRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    relayClient: single(
      (c) =>
        new RelayClient({
          service: c.relayIntegrationService,
          branchId: () =>
            c.relayIntegrationService.links().find((l) => l.isEnabled)?.branchId ?? null,
          logger: c.logger,
        }),
    ),
    customerService: single(
      (c) =>
        new CustomerService({
          customers: new SqliteCustomerRepository(c.db),
          tiers: new SqliteMembershipTierRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    loyaltyService: single(
      (c) =>
        new LoyaltyService({
          loyalty: new SqliteLoyaltyRepository(c.db),
          customers: new SqliteCustomerRepository(c.db),
          tiers: new SqliteMembershipTierRepository(c.db),
          settings: new SqliteSettingsRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    membershipService: single(
      (c) =>
        new MembershipService({
          tiers: new SqliteMembershipTierRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    salesChannelService: single(
      (c) =>
        new SalesChannelService({
          channels: new SqliteSalesChannelRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    kitchenService: single(
      (c) =>
        new KitchenService({
          kots: new SqliteKotRepository(c.db, now),
          queries: c.kitchenQueries,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
        }),
    ),
    backupService: single(
      (c) =>
        new BackupService({
          store: new FileBackupStore({
            db: c.db,
            databasePath: config.databasePath,
            databaseKey: config.databaseKey,
            backupDir: config.backupDir,
            copyDir: config.backupCopyDir,
            deriveKey: (passphrase, kdf) => new ScryptKeyDerivation().keyFor(passphrase, kdf),
            onCopyError: (error) =>
              c.logger.warn({ err: error }, 'could not copy the backup to the second folder'),
          }),
          backups: new SqliteBackupRepository(c.db),
          unitOfWork: c.unitOfWork,
          ids: c.ids,
          clock: c.clock,
          timeZone: config.timeZone,
          lifecycle: overrides.hubLifecycle ?? {
            requestRestart: (reason) => c.logger.warn({ reason }, 'restart requested'),
          },
        }),
    ),
    reportQueries: single((c) => new SqliteReportQueries(c.db, c.calendar)),
    gstQueries: single((c) => new SqliteGstQueries(c.db)),
    reportScheduleService: single(
      (c) =>
        new ReportScheduleService({
          schedules: new SqliteReportScheduleRepository(c.db),
          files: new SqliteReportFileRepository(c.db),
          store: new FileReportStore({
            dir: config.reportsDir,
            copyDir: config.reportsCopyDir,
            onCopyError: (error) =>
              c.logger.warn({ err: error }, 'could not copy the report to the second folder'),
          }),
          reports: c.reportQueries,
          gst: c.gstQueries,
          settings: new SqliteSettingsRepository(c.db),
          calendar: c.calendar,
          xlsx: writeXlsx,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    billingQueries: single(
      (c) =>
        new SqliteBillingQueries(
          c.db,
          new SqliteInvoiceRepository(c.db, now, (b, at) => c.calendar.businessDate(b, at)),
        ),
    ),
    billingService: single(
      (c) =>
        new BillingService({
          invoices: new SqliteInvoiceRepository(c.db, now, (b, at) =>
            c.calendar.businessDate(b, at),
          ),
          orders: new SqliteOrderRepository(c.db, now),
          coupons: new SqliteCouponRepository(c.db),
          shifts: new SqliteShiftRepository(c.db),
          catalog: new SqliteCatalogRepository(c.db),
          settings: new SqliteSettingsRepository(c.db),
          floor: new SqliteFloorRepository(c.db),
          channels: new SqliteSalesChannelRepository(c.db),
          customers: new SqliteCustomerRepository(c.db),
          customerService: c.customerService,
          loyalty: c.loyaltyService,
          tiers: new SqliteMembershipTierRepository(c.db),
          calendar: c.calendar,
          defaultTaxGroupId: () =>
            c.db
              .prepare<[], string | null>(
                "SELECT json_extract(value_json, '$') FROM settings WHERE key = 'billing.default_tax_group_id' LIMIT 1",
              )
              .pluck()
              .get() ?? null,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    couponService: single(
      (c) =>
        new CouponService({
          coupons: new SqliteCouponRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    printService: single(
      (c) =>
        new PrintService({
          settings: new SqliteSettingsRepository(c.db),
          billing: c.billingQueries,
          invoices: new SqliteInvoiceRepository(c.db, now, (b, at) =>
            c.calendar.businessDate(b, at),
          ),
          orders: c.orderQueries,
          kitchen: c.kitchenQueries,
          catalog: new SqliteCatalogRepository(c.db),
          encoder: escPos,
          transport: overrides.printerTransport ?? hubPrinterTransport,
          renderer:
            overrides.rasterRenderer !== undefined
              ? overrides.rasterRenderer
              : rasterRenderer(
                  { mode: c.config.raster, fontsDir: findFontsDir(c.config.fontsDir) },
                  c.logger,
                ),
          organizationName: () =>
            c.db
              .prepare<[], string>('SELECT name FROM organizations ORDER BY created_at LIMIT 1')
              .pluck()
              .get() ?? 'RestroOS',
          timeZone: c.config.timeZone,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
        }),
    ),
    shiftService: single(
      (c) =>
        new ShiftService({
          shifts: new SqliteShiftRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    inventoryService: single(
      (c) =>
        new InventoryService({
          inventory: new SqliteInventoryRepository(c.db),
          queries: new SqliteInventoryQueries(c.db),
          menu: new SqliteMenuLookup(c.db),
          calendar: c.calendar,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    inventoryProjector: single(
      (c) =>
        new InventoryProjector({
          log: new SqliteProjectionLog(c.db),
          inventory: new SqliteInventoryRepository(c.db),
          calendar: c.calendar,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
          onError: (error, event) =>
            c.logger.error(
              { err: error, seq: event.seq, eventType: event.type },
              'stock not moved for this event; skipped',
            ),
        }),
    ),
    purchasingService: single(
      (c) =>
        new PurchasingService({
          purchasing: new SqlitePurchasingRepository(c.db),
          queries: new SqlitePurchasingQueries(c.db),
          inventory: new SqliteInventoryRepository(c.db),
          branches: new SqliteSettingsRepository(c.db),
          calendar: c.calendar,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    accountingService: single(
      (c) =>
        new AccountingService({
          accounting: new SqliteAccountingRepository(c.db),
          queries: new SqliteAccountingQueries(c.db),
          branches: new SqliteSettingsRepository(c.db),
          calendar: c.calendar,
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
        }),
    ),
    accountingProjector: single(
      (c) =>
        new AccountingProjector({
          log: new SqliteProjectionLog(c.db),
          accounting: new SqliteAccountingRepository(c.db),
          sources: new SqlitePostingSources(c.db),
          branches: new SqliteSettingsRepository(c.db),
          unitOfWork: c.unitOfWork,
          clock: c.clock,
          ids: c.ids,
          onError: (error, event) =>
            c.logger.error(
              { err: error, seq: event?.seq, eventType: event?.type ?? 'stock' },
              // A document is skipped; stock movements stay behind the cursor and are tried again.
              event ? 'not journaled; skipped' : 'stock not journaled yet; will retry',
            ),
        }),
    ),
    hubNetwork: overrides.hubNetwork
      ? asValue(overrides.hubNetwork)
      : single((c) =>
          hubNetwork(c.db, c.clock, { http: c.config.port, https: c.config.httpsPort }),
        ),
  });
  return container;
}
