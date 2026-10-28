import type { SetupInput } from '@restroos/application';
import type { SessionResponse } from '@restroos/contracts';
import {
  BcryptPasswordHasher,
  createTestDatabase,
  ensureTlsMaterial,
  FixedClock,
  type TestDatabase,
  type TlsMaterial,
} from '@restroos/infrastructure';
import type { AwilixContainer } from 'awilix';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { join } from 'node:path';
import pino from 'pino';
import type { ServerConfig } from '../config';
import { buildContainer, type Cradle } from '../container';
import { buildApp, type BuildAppOptions } from '../http/app';
import type { HubNetwork } from '../hub-network';
import { SetupCode } from '../setup-code';

export const ADMIN = { username: 'owner', password: 'Kolkata#Biryani2026', pin: '2580' } as const;
export const TEST_SETUP_CODE = 'TESTCODE1';

/** A complete West Bengal restaurant with liquor billed separately. */
export const SETUP_FIXTURE: SetupInput & { setupCode: string } = {
  setupCode: TEST_SETUP_CODE,
  organization: { name: 'Spice Route', legalName: 'Spice Route Hospitality Pvt Ltd' },
  branch: { name: 'Park Street', code: 'KOL1', stateCode: '19', gstin: undefined },
  liquor: {
    enabled: true,
    vatTin: '19123456789',
    exciseLicenceNo: 'EXC/KOL/2026/001',
    vatRateBp: 2000,
    surchargeBp: 0,
    separateInvoice: true,
    overrideProhibition: false,
  },
  languages: { defaultLocale: 'bn-IN', receiptLanguages: ['en', 'bn'] },
  admin: {
    username: ADMIN.username,
    fullName: 'Ananya Sen',
    password: ADMIN.password,
    pin: ADMIN.pin,
  },
  backupPassphrase: 'correct horse battery staple',
};

/** The Hub's LAN address in tests. */
export const TEST_LAN_IP = '192.168.1.20';

let tlsFixture: TlsMaterial | undefined;
/** One certificate for the whole test run: RSA key generation is slow. */
function testTls(): TlsMaterial {
  const store = new Map<string, string>();
  tlsFixture ??= ensureTlsMaterial(
    { get: (k) => store.get(k), put: (k, v) => void store.set(k, v) },
    { dns: ['restro.local', 'localhost'], ips: ['127.0.0.1', TEST_LAN_IP] },
  );
  return tlsFixture;
}

export interface TestServer {
  readonly app: FastifyInstance;
  readonly container: AwilixContainer<Cradle>;
  readonly database: TestDatabase;
  readonly clock: FixedClock;
  readonly setupCode: SetupCode;
  /** Restarts a restore asked for (the real Hub exits and is started again). */
  readonly restarts: string[];
  /** Signs in with a password and returns the session. */
  login(username?: string, password?: string): Promise<SessionResponse & { cookie: string }>;
  /** `app.inject` with a bearer token. */
  as(token: string, options: InjectOptions): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

/**
 * A real app on a real encrypted, migrated database, driven with
 * `app.inject()`. By default first-time setup has run (through the real
 * service) with SETUP_FIXTURE; pass `install: false` to start empty.
 */
export async function createTestServer(
  options: Partial<BuildAppOptions> & { config?: Partial<ServerConfig>; install?: boolean } = {},
): Promise<TestServer> {
  const database = createTestDatabase({ seed: false });
  const clock = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));
  const config: ServerConfig = {
    env: 'test',
    host: '127.0.0.1',
    port: 7400,
    httpsPort: 7443,
    mdns: false,
    raster: 'off',
    fontsDir: undefined,
    dataDir: database.dir,
    databasePath: database.path,
    databaseKey: database.key,
    backupDir: join(database.dir, 'backups'),
    backupCopyDir: null,
    backups: false,
    migrationsDir: undefined,
    webDist: undefined,
    logLevel: 'silent',
    rateLimitPerMinute: 10_000,
    secureCookies: false,
    rolloutWaves: [1],
    timeZone: 'Asia/Kolkata',
    setupCode: TEST_SETUP_CODE,
    version: '0.0.0-test',
    ...options.config,
  };
  const logger = pino({ level: 'silent' });
  const restarts: string[] = [];
  const container = buildContainer(config, logger, database.db, {
    clock,
    hubLifecycle: { requestRestart: (reason) => restarts.push(reason) },
    hasher: new BcryptPasswordHasher({ password: 4, pin: 4 }), // fast in tests
    hubNetwork: {
      httpPort: 7400,
      httpsPort: 7443,
      tls: testTls(),
      addresses: () => [TEST_LAN_IP],
      refresh: () => false,
    } satisfies HubNetwork,
    rasterRenderer: null,
  });
  const setupCode = new SetupCode(logger, config.setupCode);
  if (options.install ?? true) {
    await container.cradle.setupService.run(SETUP_FIXTURE, {
      ipAddress: '127.0.0.1',
      correlationId: 'test-setup',
    });
  }
  const app = await buildApp(container, { ...options, setupCode });
  await app.ready();

  return {
    app,
    container,
    database,
    clock,
    setupCode,
    restarts,
    async login(username = ADMIN.username, password = ADMIN.password) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username, password },
      });
      if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
      const cookie = res.cookies.find((c) => c.name === 'restro_rt');
      return { ...(res.json() as SessionResponse), cookie: `restro_rt=${cookie?.value ?? ''}` };
    },
    as(token, injectOptions) {
      return app.inject({
        ...injectOptions,
        headers: { ...injectOptions.headers, authorization: `Bearer ${token}` },
      });
    },
    async close() {
      await app.close();
      database.close();
    },
  };
}
