import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOrCreateDatabaseKey, type SecretBox } from './database-key';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'restro-key-'));
  dirs.push(d);
  return d;
};
/** A stand-in for safeStorage: reversible, but never stores the key as written. */
const box = (available = true): SecretBox => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
});

describe('database key', () => {
  it('makes a random key once, sealed by the OS keychain, and reuses it', () => {
    const dir = tempDir();
    const first = loadOrCreateDatabaseKey(dir, box(), false);
    expect(first.protectedBy).toBe('os');
    expect(first.key).toMatch(/^[\w-]{43}$/);
    expect(readFileSync(join(dir, 'db-key.sealed')).toString()).not.toContain(first.key);
    expect(loadOrCreateDatabaseKey(dir, box(), true)).toEqual(first);
    expect(loadOrCreateDatabaseKey(tempDir(), box(), false).key).not.toBe(first.key);
  });

  it('falls back to a private file without a keychain', () => {
    const dir = tempDir();
    const key = loadOrCreateDatabaseKey(dir, box(false), false);
    expect(key.protectedBy).toBe('file');
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'db-key.txt')).mode & 0o777).toBe(0o600);
    }
    expect(loadOrCreateDatabaseKey(dir, box(false), true)).toEqual(key);
  });

  it('never replaces a lost key while a database exists', () => {
    expect(() => loadOrCreateDatabaseKey(tempDir(), box(), true)).toThrow(
      /restore the latest backup/,
    );
    const dir = tempDir();
    loadOrCreateDatabaseKey(dir, box(), false);
    expect(() => loadOrCreateDatabaseKey(dir, box(false), true)).toThrow(/keychain/);
  });
});
