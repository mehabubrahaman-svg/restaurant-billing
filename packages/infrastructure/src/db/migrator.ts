import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqliteDatabase } from './connection';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrateOptions {
  readonly migrationsDir: string;
  /**
   * Called once before the first pending migration is applied to a database
   * that already has data (never for a brand new database).
   */
  readonly beforeMigrate?: (pending: readonly Migration[]) => void;
  readonly now?: () => Date;
}

const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function loadMigrations(dir: string): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const match = FILE_RE.exec(file);
      if (!match) throw new Error(`migration file name must look like 0001_name.sql: ${file}`);
      const sql = readFileSync(join(dir, file), 'utf8');
      return {
        version: Number(match[1]),
        name: match[2]!,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
  migrations.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new Error(`migrations must be numbered 1..n without gaps: ${m.version}`);
  });
  return migrations;
}

/**
 * Applies pending migrations in order, each in its own transaction, and
 * records them with a checksum. An already-applied migration whose file has
 * changed stops startup: released migrations are immutable.
 */
export function migrate(db: SqliteDatabase, options: MigrateOptions): Migration[] {
  const now = options.now ?? (() => new Date());
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const applied = new Map(
    db
      .prepare<[], { version: number; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations',
      )
      .all()
      .map((row) => [row.version, row.checksum]),
  );
  const migrations = loadMigrations(options.migrationsDir);

  for (const [version, checksum] of applied) {
    const file = migrations.find((m) => m.version === version);
    if (!file) throw new Error(`database has migration ${version}, which this build does not know`);
    if (file.checksum !== checksum) {
      throw new Error(`migration ${version}_${file.name} was modified after it was applied`);
    }
  }

  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return [];
  if (applied.size > 0) options.beforeMigrate?.(pending);

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, migration.checksum, now().toISOString());
    }).immediate();
  }
  // Migrations run with foreign keys enforced, but verify the end state too.
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0)
    throw new Error(`foreign key violations after migration: ${violations.length}`);
  return pending;
}
