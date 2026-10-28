import type { Clock } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

/** Secrets the Hub generates for itself; stored only inside the encrypted database. */
export class SqliteSecretStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: Clock,
  ) {}

  get(name: string): string | undefined {
    return this.db
      .prepare<[string], string>('SELECT value FROM system_secrets WHERE name = ?')
      .pluck()
      .get(name);
  }

  /** Returns the stored value, creating it with `create()` the first time. */
  getOrCreate(name: string, create: () => string): string {
    const existing = this.get(name);
    if (existing !== undefined) return existing;
    const value = create();
    this.db
      .prepare(
        'INSERT INTO system_secrets (name, value, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING',
      )
      .run(name, value, this.clock.now().toISOString());
    return this.get(name)!;
  }

  put(name: string, value: string): void {
    const now = this.clock.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO system_secrets (name, value, created_at) VALUES (?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET value = excluded.value, rotated_at = ?`,
      )
      .run(name, value, now, now);
  }
}
