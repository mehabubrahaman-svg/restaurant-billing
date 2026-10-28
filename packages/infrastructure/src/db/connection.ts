import Database from 'better-sqlite3-multiple-ciphers';

export type SqliteDatabase = Database.Database;

export interface OpenDatabaseOptions {
  /** File path, or ':memory:' for tests. */
  readonly path: string;
  /**
   * Encryption key. Required for files: the database is always encrypted at
   * rest (SQLCipher v4 format, AES-256). Omit only for ':memory:'.
   */
  readonly key?: string;
  readonly busyTimeoutMs?: number;
}

/**
 * Opens the database, unlocks it and applies the standard pragmas
 * (docs/03-database-design.md §1). Throws `DatabaseLockedError` if the key is wrong.
 */
export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  const inMemory = options.path === ':memory:';
  if (!inMemory && !options.key) {
    throw new Error('refusing to open an unencrypted database file: a key is required');
  }

  const db = new Database(options.path);
  try {
    if (options.key) {
      db.pragma(`cipher = 'sqlcipher'`);
      db.pragma('legacy = 4');
      db.pragma(`key = ${quoteKey(options.key)}`);
      // The key is only checked when a page is read.
      try {
        db.prepare('SELECT count(*) FROM sqlite_master').get();
      } catch (error) {
        throw new DatabaseLockedError(options.path, error);
      }
    }
    if (!inMemory) db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
    db.pragma('cache_size = -65536');
    db.pragma('temp_store = MEMORY');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export class DatabaseLockedError extends Error {
  constructor(path: string, cause: unknown) {
    super(`cannot unlock database ${path}: wrong key or not a RestroOS database`, { cause });
    this.name = 'DatabaseLockedError';
  }
}

function quoteKey(key: string): string {
  return `'${key.replaceAll("'", "''")}'`;
}

/** Writes an encrypted, consistent copy of the live database (same key). */
export function snapshotDatabase(db: SqliteDatabase, destinationPath: string): void {
  db.prepare('VACUUM INTO ?').run(destinationPath);
}
