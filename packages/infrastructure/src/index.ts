export { verifyAuditChain, type AuditChainResult } from './audit/audit-chain';
export { canonicalJson } from './audit/canonical-json';
export {
  DatabaseLockedError,
  openDatabase,
  snapshotDatabase,
  type OpenDatabaseOptions,
  type SqliteDatabase,
} from './db/connection';
export { loadMigrations, migrate, type Migration, type MigrateOptions } from './db/migrator';
export { assertVersionMatched } from './db/optimistic';
export { SqliteUnitOfWork, type SqliteUnitOfWorkDeps } from './db/unit-of-work';
export { InProcessEventBus, type EventBusLogger } from './events/in-process-event-bus';
export { SqliteIdempotencyStore } from './idempotency/sqlite-idempotency-store';
export { FixedClock, systemClock } from './system/system-clock';
export { uuidv7Generator } from './system/uuidv7-generator';
export { findMigrationsDir } from './db/paths';
export {
  createTestDatabase,
  TEST_BRANCH_ID,
  TEST_ORG_ID,
  TEST_USER_ID,
  type TestDatabase,
} from './testing/test-database';
