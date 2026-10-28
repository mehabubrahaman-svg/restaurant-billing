import {
  AuthService,
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
  SqliteAuditQueries,
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
import { asFunction, asValue, createContainer, type AwilixContainer } from 'awilix';
import type { Logger } from 'pino';
import type { ServerConfig } from './config';

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
}

export interface ContainerOverrides {
  clock?: Clock;
  ids?: IdGenerator;
  /** Tests use a cheap bcrypt cost. */
  hasher?: PasswordHasher;
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
  });
  return container;
}
