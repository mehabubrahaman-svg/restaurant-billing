import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from './connection';
import { loadMigrations, migrate } from './migrator';
import { findMigrationsDir } from './paths';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function scratch(): { dir: string; migrations: string; db: SqliteDatabase } {
  const dir = mkdtempSync(join(tmpdir(), 'restroos-migrate-'));
  const migrations = join(dir, 'migrations');
  cpSync(findMigrationsDir(), migrations, { recursive: true });
  const db = openDatabase({ path: join(dir, 'm.db'), key: 'k' });
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, migrations, db };
}

describe('migrate', () => {
  it('applies every migration to a new database, then nothing on the next start', () => {
    const { db, migrations } = scratch();
    const count = readdirSync(migrations).filter((f) => f.endsWith('.sql')).length;
    expect(migrate(db, { migrationsDir: migrations })).toHaveLength(count);
    expect(migrate(db, { migrationsDir: migrations })).toEqual([]);
    expect(db.prepare('SELECT count(*) FROM schema_migrations').pluck().get()).toBe(count);
    expect(db.prepare('SELECT count(*) FROM permissions').pluck().get()).toBe(52);
  });

  it('does not back up a brand-new database', () => {
    const { db, migrations } = scratch();
    const beforeMigrate = vi.fn();
    migrate(db, { migrationsDir: migrations, beforeMigrate });
    expect(beforeMigrate).not.toHaveBeenCalled();
  });

  it('backs up before applying new migrations to an existing database', () => {
    const { db, migrations } = scratch();
    migrate(db, { migrationsDir: migrations });
    const next = loadMigrations(migrations).length + 1;
    writeFileSync(
      join(migrations, `${String(next).padStart(4, '0')}_add_probe.sql`),
      'CREATE TABLE probe (id TEXT PRIMARY KEY) STRICT;',
    );
    const beforeMigrate = vi.fn();
    const applied = migrate(db, { migrationsDir: migrations, beforeMigrate });
    expect(applied.map((m) => m.name)).toEqual(['add_probe']);
    expect(beforeMigrate).toHaveBeenCalledOnce();
  });

  it('stops if an applied migration was edited', () => {
    const { db, migrations } = scratch();
    migrate(db, { migrationsDir: migrations });
    const first = readdirSync(migrations).sort()[0]!;
    writeFileSync(join(migrations, first), '-- tampered\n', { flag: 'a' });
    expect(() => migrate(db, { migrationsDir: migrations })).toThrow(
      /modified after it was applied/,
    );
  });

  it('rolls back a failing migration completely', () => {
    const { db, migrations } = scratch();
    migrate(db, { migrationsDir: migrations });
    const next = loadMigrations(migrations).length + 1;
    writeFileSync(
      join(migrations, `${String(next).padStart(4, '0')}_broken.sql`),
      'CREATE TABLE half_done (id TEXT) STRICT; INSERT INTO no_such_table VALUES (1);',
    );
    expect(() => migrate(db, { migrationsDir: migrations })).toThrow();
    const exists = db
      .prepare("SELECT count(*) FROM sqlite_master WHERE name = 'half_done'")
      .pluck()
      .get();
    expect(exists).toBe(0);
  });

  it('rejects gaps in numbering', () => {
    const { migrations } = scratch();
    writeFileSync(join(migrations, '0099_gap.sql'), 'SELECT 1;');
    expect(() => loadMigrations(migrations)).toThrow(/without gaps/);
  });
});
