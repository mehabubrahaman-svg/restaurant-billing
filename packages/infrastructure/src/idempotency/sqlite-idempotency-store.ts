import type { Clock, IdempotencyStore, StoredResponse } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

const DEFAULT_RETENTION_MS = 48 * 60 * 60 * 1000; // a tablet may stay offline over a long shift

export class SqliteIdempotencyStore implements IdempotencyStore {
  private readonly selectStmt;
  private readonly insertStmt;
  private readonly purgeStmt;

  constructor(
    db: SqliteDatabase,
    private readonly clock: Clock,
    private readonly retentionMs = DEFAULT_RETENTION_MS,
  ) {
    this.selectStmt = db.prepare<
      [string, string, string],
      { request_hash: string; status_code: number; response_body: string }
    >(
      `SELECT request_hash, status_code, response_body FROM idempotency_keys
        WHERE scope = ? AND key = ? AND expires_at > ?`,
    );
    this.insertStmt = db.prepare(
      `INSERT INTO idempotency_keys (scope, key, request_hash, status_code, response_body, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (scope, key) DO NOTHING`,
    );
    // Expired idempotency keys are a cache, not business data, so they are
    // the one thing allowed to be physically removed.
    // eslint-disable-next-line no-restricted-syntax
    this.purgeStmt = db.prepare('DELETE FROM idempotency_keys WHERE expires_at <= ?');
  }

  find(scope: string, key: string): StoredResponse | undefined {
    const row = this.selectStmt.get(scope, key, this.clock.now().toISOString());
    return (
      row && { requestHash: row.request_hash, statusCode: row.status_code, body: row.response_body }
    );
  }

  save(scope: string, key: string, response: StoredResponse): void {
    const now = this.clock.now();
    this.insertStmt.run(
      scope,
      key,
      response.requestHash,
      response.statusCode,
      response.body,
      now.toISOString(),
      new Date(now.getTime() + this.retentionMs).toISOString(),
    );
  }

  purgeExpired(): number {
    return this.purgeStmt.run(this.clock.now().toISOString()).changes;
  }
}
