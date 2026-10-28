import { createTestDatabase, FixedClock, type TestDatabase } from '@restroos/infrastructure';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import type { ServerConfig } from '../config';
import { buildContainer, type Cradle } from '../container';
import { buildApp, type BuildAppOptions } from '../http/app';
import type { AwilixContainer } from 'awilix';

export interface TestServer {
  readonly app: FastifyInstance;
  readonly container: AwilixContainer<Cradle>;
  readonly database: TestDatabase;
  readonly clock: FixedClock;
  close(): Promise<void>;
}

/**
 * A real app on a real encrypted, migrated database, driven with
 * `app.inject()` (no network). Use one per test for isolation.
 */
export async function createTestServer(
  options: BuildAppOptions & { config?: Partial<ServerConfig> } = {},
): Promise<TestServer> {
  const database = createTestDatabase();
  const clock = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));
  const config: ServerConfig = {
    env: 'test',
    host: '127.0.0.1',
    port: 0,
    dataDir: database.dir,
    databasePath: database.path,
    databaseKey: database.key,
    migrationsDir: undefined,
    webDist: undefined,
    logLevel: 'silent',
    rateLimitPerMinute: 10_000,
    version: '0.0.0-test',
    ...options.config,
  };
  const container = buildContainer(config, pino({ level: 'silent' }), database.db, { clock });
  const app = await buildApp(container, options);
  await app.ready();
  return {
    app,
    container,
    database,
    clock,
    async close() {
      await app.close();
      database.close();
    },
  };
}
