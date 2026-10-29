import Database from 'better-sqlite3-multiple-ciphers';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export interface Hub {
  id: string;
  name: string;
  keyHash: string;
  webhookSecret: string;
  middlewareUrl: string | null;
  middlewareKey: string | null;
}

export interface InboxMessage {
  id: string;
  hubId: string;
  event: string;
  body: string;
  status: 'PENDING' | 'DONE' | 'FAILED';
  error: string | null;
  createdAt: string;
}

export interface OutboxMessage {
  id: string;
  hubId: string;
  kind: string;
  body: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  nextAttemptAt: string;
  error: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hubs (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    key_hash        TEXT NOT NULL,              -- sha256 of the Hub's key; the key itself is never kept
    webhook_secret  TEXT NOT NULL,              -- shared with the middleware, signs its webhooks
    middleware_url  TEXT,                       -- where menu, availability and order status go
    middleware_key  TEXT,
    created_at      TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS inbox (
    id              TEXT PRIMARY KEY,
    hub_id          TEXT NOT NULL REFERENCES hubs(id),
    event           TEXT NOT NULL,
    external_key    TEXT NOT NULL,              -- event + channel + order id: a webhook sent twice is kept once
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','FAILED')),
    error           TEXT,
    created_at      TEXT NOT NULL,
    delivered_at    TEXT,
    acked_at        TEXT,
    UNIQUE (hub_id, external_key)
) STRICT;
CREATE TABLE IF NOT EXISTS outbox (
    id              TEXT PRIMARY KEY,           -- the Hub's id for the message: a resend is kept once
    hub_id          TEXT NOT NULL REFERENCES hubs(id),
    kind            TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    error           TEXT,
    created_at      TEXT NOT NULL,
    sent_at         TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS ix_inbox_pending ON inbox(hub_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_outbox_due ON outbox(status, next_attempt_at);
`;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The relay's own small database: hubs, webhooks waiting for a Hub, and messages for the middleware. */
export class RelayStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** A new Hub. The key and webhook secret are shown once, to set up the Hub and the middleware. */
  addHub(input: { name: string; middlewareUrl?: string; middlewareKey?: string }) {
    const id = randomUUID();
    const key = randomBytes(32).toString('base64url');
    const webhookSecret = randomBytes(32).toString('base64url');
    this.db
      .prepare(
        `INSERT INTO hubs (id, name, key_hash, webhook_secret, middleware_url, middleware_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        sha256(key),
        webhookSecret,
        input.middlewareUrl ?? null,
        input.middlewareKey ?? null,
        new Date().toISOString(),
      );
    return { id, key, webhookSecret };
  }

  hub(id: string): Hub | undefined {
    return this.db
      .prepare<[string], Hub>(
        `SELECT id, name, key_hash AS keyHash, webhook_secret AS webhookSecret,
                middleware_url AS middlewareUrl, middleware_key AS middlewareKey
           FROM hubs WHERE id = ?`,
      )
      .get(id);
  }

  /** The Hub's key, checked without keeping it. */
  checkKey(hub: Hub, key: string): boolean {
    return sha256(key) === hub.keyHash;
  }

  /** Keeps a webhook for the Hub; the same event for the same order again returns the first. */
  receive(hubId: string, event: string, externalKey: string, body: string, at: Date): InboxMessage {
    this.db
      .prepare(
        `INSERT INTO inbox (id, hub_id, event, external_key, body, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (hub_id, external_key) DO NOTHING`,
      )
      .run(randomUUID(), hubId, event, externalKey, body, at.toISOString());
    return this.db
      .prepare<[string, string], InboxMessage>(
        `SELECT id, hub_id AS hubId, event, body, status, error, created_at AS createdAt
           FROM inbox WHERE hub_id = ? AND external_key = ?`,
      )
      .get(hubId, externalKey)!;
  }

  /** Webhooks the Hub hasn't acknowledged, oldest first. */
  pendingFor(hubId: string): InboxMessage[] {
    return this.db
      .prepare<[string], InboxMessage>(
        `SELECT id, hub_id AS hubId, event, body, status, error, created_at AS createdAt
           FROM inbox WHERE hub_id = ? AND status = 'PENDING' ORDER BY created_at, rowid`,
      )
      .all(hubId);
  }

  markDelivered(id: string, at: Date): void {
    this.db.prepare('UPDATE inbox SET delivered_at = ? WHERE id = ?').run(at.toISOString(), id);
  }

  acknowledge(hubId: string, id: string, ok: boolean, error: string | null, at: Date): void {
    this.db
      .prepare(
        "UPDATE inbox SET status = ?, error = ?, acked_at = ? WHERE id = ? AND hub_id = ? AND status = 'PENDING'",
      )
      .run(ok ? 'DONE' : 'FAILED', error, at.toISOString(), id, hubId);
  }

  inbox(id: string): InboxMessage | undefined {
    return this.db
      .prepare<[string], InboxMessage>(
        `SELECT id, hub_id AS hubId, event, body, status, error, created_at AS createdAt FROM inbox WHERE id = ?`,
      )
      .get(id);
  }

  /** Keeps a Hub message for the middleware; the same id again is kept once. */
  queue(hubId: string, id: string, kind: string, body: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO outbox (id, hub_id, kind, body, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      )
      .run(id, hubId, kind, body, at.toISOString(), at.toISOString());
  }

  due(at: Date, limit = 50): OutboxMessage[] {
    return this.db
      .prepare<[string, number], OutboxMessage>(
        `SELECT id, hub_id AS hubId, kind, body, status, attempts, next_attempt_at AS nextAttemptAt, error
           FROM outbox WHERE status = 'PENDING' AND next_attempt_at <= ? ORDER BY created_at, rowid LIMIT ?`,
      )
      .all(at.toISOString(), limit);
  }

  outbox(id: string): OutboxMessage | undefined {
    return this.db
      .prepare<[string], OutboxMessage>(
        `SELECT id, hub_id AS hubId, kind, body, status, attempts, next_attempt_at AS nextAttemptAt, error
           FROM outbox WHERE id = ?`,
      )
      .get(id);
  }

  markSent(id: string, at: Date): void {
    this.db
      .prepare(
        "UPDATE outbox SET status = 'SENT', sent_at = ?, attempts = attempts + 1 WHERE id = ?",
      )
      .run(at.toISOString(), id);
  }

  /** Tries again later, or gives up after `maxAttempts`. */
  markFailedAttempt(id: string, error: string, next: Date | null): void {
    this.db
      .prepare(
        `UPDATE outbox SET attempts = attempts + 1, error = ?,
                status = CASE WHEN ? IS NULL THEN 'FAILED' ELSE status END,
                next_attempt_at = COALESCE(?, next_attempt_at)
          WHERE id = ?`,
      )
      .run(error.slice(0, 500), next?.toISOString() ?? null, next?.toISOString() ?? null, id);
  }
}
