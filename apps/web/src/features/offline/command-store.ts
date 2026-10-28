import type { QueuedCommand } from './command-types';

/** Where queued commands survive a reload or a flat battery. */
export interface CommandStore {
  list(): Promise<QueuedCommand[]>;
  put(command: QueuedCommand): Promise<void>;
  remove(id: string): Promise<void>;
}

/** For tests and browsers without IndexedDB: lives as long as the page. */
export class MemoryCommandStore implements CommandStore {
  private readonly rows = new Map<string, QueuedCommand>();

  async list(): Promise<QueuedCommand[]> {
    return [...this.rows.values()].map((c) => structuredClone(c));
  }

  async put(command: QueuedCommand): Promise<void> {
    this.rows.set(command.id, structuredClone(command));
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

const DB_NAME = 'restroos-offline';
const DB_VERSION = 1;
const STORE = 'commands';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Native IndexedDB, one object store keyed by command id. Each call opens
 * its own short transaction; the queue is small (a few dozen rows at most).
 */
export class IndexedDbCommandStore implements CommandStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
    }).catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(STORE, mode);
    const result = promisify(action(tx.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    return result;
  }

  async list(): Promise<QueuedCommand[]> {
    return (await this.run('readonly', (s) => s.getAll())) as QueuedCommand[];
  }

  async put(command: QueuedCommand): Promise<void> {
    await this.run('readwrite', (s) => s.put(command));
  }

  async remove(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id));
  }
}

/** IndexedDB when the browser has it, else memory (the queue then lasts until reload). */
export function createCommandStore(): CommandStore {
  return typeof indexedDB === 'undefined' ? new MemoryCommandStore() : new IndexedDbCommandStore();
}
