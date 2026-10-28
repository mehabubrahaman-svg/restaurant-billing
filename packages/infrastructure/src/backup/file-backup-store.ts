import type { BackupFile, BackupHeader, BackupKind, BackupStore } from '@restroos/application';
import { DomainError } from '@restroos/domain';
import Database from 'better-sqlite3-multiple-ciphers';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { SqliteDatabase } from '../db/connection';

const MAGIC = 'RESTROOS-BACKUP 1\n';
const MAX_HEADER = 4096;
const CHUNK = 1 << 20;
export const BACKUP_EXTENSION = '.rbak';

export interface FileBackupStoreOptions {
  readonly db: SqliteDatabase;
  /** The live database's file and key: a restore is re-keyed to it and staged beside it. */
  readonly databasePath: string;
  readonly databaseKey: string;
  readonly backupDir: string;
  /** A second folder (USB drive, NAS share) every new backup is copied to. */
  readonly copyDir?: string | null;
  /** Re-derives a backup key (hex) from a passphrase and a header's `kdf`. */
  readonly deriveKey: (passphrase: string, kdf: string) => Promise<string>;
  readonly onCopyError?: (error: unknown) => void;
}

/** Where a staged restore waits for the next start. */
export const pendingRestorePath = (databasePath: string) =>
  join(dirname(databasePath), 'restore-pending.db');

/**
 * Backup files (docs/01 §5.5). A file is a short plaintext header (format,
 * time, kind, KDF salt, schema version, checksum) followed by a SQLCipher
 * database (AES-256 with per-page HMAC) keyed with the backup key, which is
 * derived from the owner's passphrase. So a backup opens on a new PC with the
 * passphrase alone, and never with the Hub's machine key.
 */
export class FileBackupStore implements BackupStore {
  constructor(private readonly o: FileBackupStoreOptions) {
    mkdirSync(o.backupDir, { recursive: true });
  }

  snapshot(kind: BackupKind, at: Date): BackupFile {
    const { keyHex, kdf } = this.backupKey();
    const name = `restroos-${stamp(at)}-${kind.toLowerCase().replaceAll('_', '-')}${BACKUP_EXTENSION}`;
    const target = join(this.o.backupDir, name);
    const tmp = join(this.o.backupDir, `.${name}.tmp`);
    rmSync(tmp, { force: true });
    try {
      this.o.db.prepare('VACUUM INTO ?').run(tmp);
      const copy = openWithKey(tmp, quoteKey(this.o.databaseKey));
      try {
        copy.pragma('journal_mode = DELETE');
        copy.pragma(`rekey = ${rawKey(keyHex)}`);
      } finally {
        copy.close();
      }
      const header: BackupHeader = {
        format: 1,
        createdAt: at.toISOString(),
        kind,
        kdf,
        schemaVersion: this.schemaVersion(),
        organizationName:
          this.o.db
            .prepare<[], string>('SELECT name FROM organizations ORDER BY created_at LIMIT 1')
            .pluck()
            .get() ?? null,
        sha256: sha256Of(tmp, 0),
      };
      writeBackup(target, header, tmp);
    } finally {
      rmSync(tmp, { force: true });
    }
    const header = this.readHeader(target);
    return {
      filePath: target,
      sizeBytes: statSync(target).size,
      sha256: header.sha256,
      schemaVersion: header.schemaVersion,
      copiedTo: this.copy(target),
    };
  }

  readHeader(filePath: string): BackupHeader {
    return readHeaderAt(filePath).header;
  }

  verify(filePath: string, sha256: string): boolean {
    if (!existsSync(filePath)) return false;
    try {
      const { header, offset } = readHeaderAt(filePath);
      return header.sha256 === sha256 && sha256Of(filePath, offset) === sha256;
    } catch {
      return false;
    }
  }

  async stageRestore(filePath: string, passphrase?: string): Promise<void> {
    const { header, offset } = readHeaderAt(filePath);
    if (sha256Of(filePath, offset) !== header.sha256) {
      throw new DomainError('BACKUP_UNAVAILABLE', 'the backup file is damaged');
    }
    if (header.schemaVersion > this.schemaVersion()) {
      throw new DomainError(
        'BACKUP_UNREADABLE',
        'this backup is from a newer version of RestroOS; update the Hub first',
      );
    }
    const keyHex = await this.keyFor(header, passphrase);
    const staging = join(dirname(this.o.databasePath), 'restore-staging.db');
    try {
      extractPayload(filePath, offset, staging);
      const db = openChecked(staging, keyHex);
      try {
        db.pragma(`rekey = ${quoteKey(this.o.databaseKey)}`);
      } finally {
        db.close();
      }
      renameSync(staging, pendingRestorePath(this.o.databasePath));
    } finally {
      rmSync(staging, { force: true });
    }
  }

  async importFile(bytes: Buffer, passphrase: string, at: Date) {
    const name = `restroos-${stamp(at)}-imported${BACKUP_EXTENSION}`;
    const target = join(this.o.backupDir, name);
    writeFileSync(target, bytes, { flag: 'wx' });
    try {
      const { header, offset } = readHeaderAt(target);
      if (sha256Of(target, offset) !== header.sha256) {
        throw new DomainError('BACKUP_UNAVAILABLE', 'the backup file is damaged');
      }
      const keyHex = await this.keyFor(header, passphrase);
      const probe = join(this.o.backupDir, `.${name}.probe`);
      try {
        extractPayload(target, offset, probe);
        openChecked(probe, keyHex).close();
      } finally {
        rmSync(probe, { force: true });
      }
      return {
        filePath: target,
        sizeBytes: bytes.length,
        sha256: header.sha256,
        schemaVersion: header.schemaVersion,
        copiedTo: null,
        header,
      };
    } catch (error) {
      rmSync(target, { force: true });
      throw error;
    }
  }

  remove(file: BackupFile): void {
    rmSync(file.filePath, { force: true });
    if (file.copiedTo) rmSync(file.copiedTo, { force: true });
  }

  untracked(known: ReadonlySet<string>) {
    const found: { file: BackupFile; header: BackupHeader }[] = [];
    for (const name of readdirSync(this.o.backupDir)) {
      const filePath = join(this.o.backupDir, name);
      if (!name.endsWith(BACKUP_EXTENSION) || known.has(filePath)) continue;
      try {
        const { header } = readHeaderAt(filePath);
        const copy = this.o.copyDir ? join(this.o.copyDir, name) : null;
        found.push({
          header,
          file: {
            filePath,
            sizeBytes: statSync(filePath).size,
            sha256: header.sha256,
            schemaVersion: header.schemaVersion,
            copiedTo: copy && existsSync(copy) ? copy : null,
          },
        });
      } catch {
        // Not ours, or truncated: leave it alone.
      }
    }
    return found;
  }

  private copy(filePath: string): string | null {
    if (!this.o.copyDir) return null;
    try {
      mkdirSync(this.o.copyDir, { recursive: true });
      const target = join(this.o.copyDir, basename(filePath));
      copyFileSync(filePath, target);
      return target;
    } catch (error) {
      // A missing USB drive must not stop the local backup.
      this.o.onCopyError?.(error);
      return null;
    }
  }

  private async keyFor(header: BackupHeader, passphrase?: string): Promise<string> {
    if (passphrase !== undefined) return this.o.deriveKey(passphrase, header.kdf);
    const own = this.backupKey();
    if (own.kdf !== header.kdf) {
      throw new DomainError(
        'BACKUP_UNREADABLE',
        'this backup was made with another backup passphrase; enter that passphrase',
      );
    }
    return own.keyHex;
  }

  private backupKey(): { keyHex: string; kdf: string } {
    const secret = this.o.db.prepare<[string], string>(
      'SELECT value FROM system_secrets WHERE name = ?',
    );
    const keyHex = secret.pluck().get('backup.key');
    const kdf = secret.pluck().get('backup.kdf');
    if (!keyHex || !kdf) {
      throw new DomainError('BACKUP_UNAVAILABLE', 'finish setup first: there is no backup key yet');
    }
    return { keyHex, kdf };
  }

  private schemaVersion(): number {
    return (
      this.o.db
        .prepare<[], number>('SELECT coalesce(max(version), 0) FROM schema_migrations')
        .pluck()
        .get() ?? 0
    );
  }
}

/**
 * Moves a staged restore into place before the database is opened. The data
 * it replaces is kept under `restore/` (and was also backed up as PRE_RESTORE).
 * Returns where the old files went, or null when nothing was staged.
 */
export function applyPendingRestore(databasePath: string, at: Date): string | null {
  const pending = pendingRestorePath(databasePath);
  if (!existsSync(pending)) return null;
  const keepDir = join(dirname(databasePath), 'restore');
  mkdirSync(keepDir, { recursive: true });
  const replaced = join(keepDir, `replaced-${stamp(at)}.db`);
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(databasePath + suffix)) renameSync(databasePath + suffix, replaced + suffix);
  }
  renameSync(pending, databasePath);
  return replaced;
}

function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '').slice(0, 18);
}

function quoteKey(key: string): string {
  return `'${key.replaceAll("'", "''")}'`;
}

function rawKey(hex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('backup key must be 32 bytes of hex');
  return `"x'${hex}'"`;
}

function openWithKey(path: string, keyPragma: string): SqliteDatabase {
  const db = new Database(path);
  db.pragma(`cipher = 'sqlcipher'`);
  db.pragma('legacy = 4');
  db.pragma(`key = ${keyPragma}`);
  return db;
}

/** Opens a decrypted-on-read backup and checks it is whole and is a RestroOS database. */
function openChecked(path: string, keyHex: string): SqliteDatabase {
  let db: SqliteDatabase | undefined;
  try {
    db = openWithKey(path, rawKey(keyHex));
    const integrity = db.pragma('integrity_check', { simple: true });
    const orgs = db.prepare<[], number>('SELECT count(*) FROM organizations').pluck().get();
    if (integrity !== 'ok' || !orgs) throw new Error(`integrity: ${String(integrity)}`);
    return db;
  } catch (error) {
    db?.close();
    throw new DomainError(
      'BACKUP_UNREADABLE',
      'the passphrase does not open this backup, or it is not a RestroOS backup',
      { cause: String(error) },
    );
  }
}

function readHeaderAt(filePath: string): { header: BackupHeader; offset: number } {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(MAX_HEADER);
    const n = readSync(fd, buf, 0, MAX_HEADER, 0);
    const text = buf.subarray(0, n).toString('utf8');
    const end = text.indexOf('\n', MAGIC.length);
    if (!text.startsWith(MAGIC) || end < 0) {
      throw new DomainError('BACKUP_UNREADABLE', 'not a RestroOS backup file');
    }
    const header = JSON.parse(text.slice(MAGIC.length, end)) as BackupHeader;
    return { header, offset: Buffer.byteLength(text.slice(0, end + 1)) };
  } finally {
    closeSync(fd);
  }
}

function sha256Of(filePath: string, offset: number): string {
  const hash = createHash('sha256');
  eachChunk(filePath, offset, (chunk) => hash.update(chunk));
  return hash.digest('hex');
}

function eachChunk(filePath: string, offset: number, fn: (chunk: Buffer) => void) {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    for (let pos = offset; ;) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n === 0) break;
      fn(buf.subarray(0, n));
      pos += n;
    }
  } finally {
    closeSync(fd);
  }
}

function writeBackup(target: string, header: BackupHeader, payload: string) {
  const fd = openSync(target, 'wx');
  try {
    writeSync(fd, `${MAGIC}${JSON.stringify(header)}\n`);
    eachChunk(payload, 0, (chunk) => writeSync(fd, chunk));
    closeSync(fd);
  } catch (error) {
    closeSync(fd);
    rmSync(target, { force: true });
    throw error;
  }
}

function extractPayload(filePath: string, offset: number, target: string) {
  rmSync(target, { force: true });
  const fd = openSync(target, 'wx');
  try {
    eachChunk(filePath, offset, (chunk) => writeSync(fd, chunk));
  } finally {
    closeSync(fd);
  }
}
