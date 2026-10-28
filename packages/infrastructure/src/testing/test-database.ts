import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type SqliteDatabase } from '../db/connection';
import { migrate } from '../db/migrator';
import { findMigrationsDir } from '../db/paths';

export const TEST_ORG_ID = '0192f000-0000-7000-8000-000000000001';
export const TEST_BRANCH_ID = '0192f000-0000-7000-8000-000000000002';
export const TEST_USER_ID = '0192f000-0000-7000-8000-000000000003';

export interface TestDatabase {
  readonly db: SqliteDatabase;
  readonly path: string;
  readonly key: string;
  readonly dir: string;
  close(): void;
}

/**
 * A fully migrated, encrypted database in a temporary directory, seeded with
 * one organisation, one West Bengal branch and one user (pass `seed: false`
 * for an empty, freshly migrated database). Real file + real encryption, so
 * tests exercise the same code paths as production.
 */
export function createTestDatabase(options: { seed?: boolean } = {}): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'restroos-test-'));
  const path = join(dir, 'restro.db');
  const key = randomBytes(16).toString('hex');
  const db = openDatabase({ path, key });
  migrate(db, { migrationsDir: findMigrationsDir() });
  if (options.seed ?? true) seed(db);
  return {
    db,
    path,
    key,
    dir,
    close() {
      if (db.open) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seed(db: SqliteDatabase): void {
  const t = '2026-10-28T00:00:00.000Z';
  db.prepare(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, 'Test Restaurants Pvt Ltd', ?, ?)`,
  ).run(TEST_ORG_ID, t, t);
  db.prepare(
    `INSERT INTO branches (id, organization_id, code, name, state_code, created_at, updated_at)
     VALUES (?, ?, 'KOL1', 'Park Street', '19', ?, ?)`,
  ).run(TEST_BRANCH_ID, TEST_ORG_ID, t, t);
  db.prepare(
    `INSERT INTO users (id, organization_id, username, full_name, password_hash, created_at, updated_at)
     VALUES (?, ?, 'owner', 'Test Owner', 'x', ?, ?)`,
  ).run(TEST_USER_ID, TEST_ORG_ID, t, t);
}
