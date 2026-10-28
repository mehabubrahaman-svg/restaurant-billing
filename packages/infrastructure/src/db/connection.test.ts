import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { DatabaseLockedError, openDatabase, snapshotDatabase } from './connection';

let t: TestDatabase | undefined;
afterEach(() => t?.close());

describe('openDatabase', () => {
  it('encrypts the file at rest', () => {
    t = createTestDatabase();
    t.db.pragma('wal_checkpoint(TRUNCATE)');
    const bytes = readFileSync(t.path);
    expect(bytes.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    expect(bytes.includes(Buffer.from('Park Street'))).toBe(false);
  });

  it('refuses the wrong key', () => {
    t = createTestDatabase();
    t.db.close();
    expect(() => openDatabase({ path: t!.path, key: 'wrong-key' })).toThrow(DatabaseLockedError);
  });

  it('refuses to open a file without a key', () => {
    t = createTestDatabase();
    expect(() => openDatabase({ path: join(t!.dir, 'plain.db') })).toThrow(/key is required/);
  });

  it('applies the standard pragmas', () => {
    t = createTestDatabase();
    expect(t.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(t.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(t.db.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
  });

  it('writes snapshots that stay encrypted and reopen with the same key', () => {
    t = createTestDatabase();
    const copy = join(t.dir, 'snapshot.db');
    snapshotDatabase(t.db, copy);
    expect(readFileSync(copy).includes(Buffer.from('Park Street'))).toBe(false);
    const reopened = openDatabase({ path: copy, key: t.key });
    expect(reopened.prepare('SELECT name FROM branches').pluck().get()).toBe('Park Street');
    reopened.close();
  });
});
