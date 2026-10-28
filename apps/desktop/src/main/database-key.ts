import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Electron's safeStorage: Windows DPAPI, macOS Keychain, libsecret/kwallet on Linux. */
export interface SecretBox {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface DatabaseKey {
  readonly key: string;
  /** `os` when the OS keychain protects it; `file` when only file permissions do. */
  readonly protectedBy: 'os' | 'file';
}

const SEALED = 'db-key.sealed';
const PLAIN = 'db-key.txt';

/**
 * The SQLCipher key for the Hub database (docs/01 §5.4): random, made on
 * first run, and sealed with a machine-bound OS secret so the database file
 * alone, or a copy of the disk, cannot be opened. On Linux without a keyring
 * it falls back to a file only this user can read, and says so.
 *
 * It never makes a new key when a database already exists: that would lock
 * the restaurant out of its data. Recovery then is a restore from backup
 * with the backup passphrase.
 */
export function loadOrCreateDatabaseKey(
  dir: string,
  box: SecretBox,
  databaseExists: boolean,
): DatabaseKey {
  mkdirSync(dir, { recursive: true });
  const sealed = join(dir, SEALED);
  const plain = join(dir, PLAIN);
  if (existsSync(sealed)) {
    if (!box.isEncryptionAvailable()) {
      throw new Error(
        'the OS keychain that protects the database key is not available; sign in to the desktop session and start RestroOS again',
      );
    }
    return { key: box.decryptString(readFileSync(sealed)), protectedBy: 'os' };
  }
  if (existsSync(plain)) return { key: readFileSync(plain, 'utf8').trim(), protectedBy: 'file' };
  if (databaseExists) {
    throw new Error(
      'the database key is missing; restore the latest backup with the backup passphrase',
    );
  }
  const key = randomBytes(32).toString('base64url');
  if (box.isEncryptionAvailable()) {
    writeFileSync(sealed, box.encryptString(key), { mode: 0o600 });
    return { key, protectedBy: 'os' };
  }
  writeFileSync(plain, key, { mode: 0o600 });
  chmodSync(plain, 0o600);
  return { key, protectedBy: 'file' };
}
