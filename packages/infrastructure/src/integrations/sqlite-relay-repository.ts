import type { RelayLinkRecord, RelayMessageRecord, RelayRepository } from '@restroos/application';
import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

/** The user relay orders are entered as. It has no password and can't sign in. */
export const ONLINE_ORDERS_USERNAME = 'online-orders';

type LinkRow = Omit<RelayLinkRecord, 'isEnabled'> & { isEnabled: number };
const LINK_COLUMNS = `branch_id AS branchId, relay_url AS relayUrl, hub_id AS hubId, hub_key AS hubKey,
                      is_enabled AS isEnabled, actor_user_id AS actorUserId, version`;
const toLink = (r: LinkRow): RelayLinkRecord => ({ ...r, isEnabled: r.isEnabled === 1 });

type MessageRow = Omit<RelayMessageRecord, 'payload'> & { payloadJson: string };
const MESSAGE_COLUMNS = `id, branch_id AS branchId, direction, kind, status, channel_code AS channelCode,
                         external_order_id AS externalOrderId, order_id AS orderId, payload_json AS payloadJson,
                         error, created_at AS createdAt, handled_at AS handledAt`;
const toMessage = ({ payloadJson, ...r }: MessageRow): RelayMessageRecord => ({
  ...r,
  payload: JSON.parse(payloadJson) as unknown,
});

export class SqliteRelayRepository implements RelayRepository {
  constructor(private readonly db: SqliteDatabase) {}

  link(branchId: string): RelayLinkRecord | undefined {
    const r = this.db
      .prepare<[string], LinkRow>(`SELECT ${LINK_COLUMNS} FROM relay_links WHERE branch_id = ?`)
      .get(branchId);
    return r && toLink(r);
  }

  links(): RelayLinkRecord[] {
    return this.db
      .prepare<[], LinkRow>(`SELECT ${LINK_COLUMNS} FROM relay_links`)
      .all()
      .map(toLink);
  }

  saveLink(r: RelayLinkRecord, actorId: string | null, at: Date): void {
    if (r.version === 1) {
      this.db
        .prepare(
          `INSERT INTO relay_links (branch_id, relay_url, hub_id, hub_key, is_enabled, actor_user_id,
                                    updated_at, updated_by, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          r.branchId,
          r.relayUrl,
          r.hubId,
          r.hubKey,
          r.isEnabled ? 1 : 0,
          r.actorUserId,
          at.toISOString(),
          actorId,
        );
      return;
    }
    const result = this.db
      .prepare(
        `UPDATE relay_links SET relay_url = ?, hub_id = ?, hub_key = ?, is_enabled = ?, actor_user_id = ?,
                updated_at = ?, updated_by = ?, version = ?
          WHERE branch_id = ? AND version = ?`,
      )
      .run(
        r.relayUrl,
        r.hubId,
        r.hubKey,
        r.isEnabled ? 1 : 0,
        r.actorUserId,
        at.toISOString(),
        actorId,
        r.version,
        r.branchId,
        r.version - 1,
      );
    assertVersionMatched(result, 'RelayLink', r.branchId);
  }

  ensureActor(): string {
    const existing = this.db
      .prepare<[string], string>('SELECT id FROM users WHERE username = ? LIMIT 1')
      .pluck()
      .get(ONLINE_ORDERS_USERNAME);
    if (existing) return existing;
    const id = randomUUID();
    const now = new Date().toISOString();
    // Inactive, with a password hash nothing matches: it only ever appears as who entered an order.
    this.db
      .prepare(
        `INSERT INTO users (id, organization_id, username, full_name, password_hash, is_active, created_at, updated_at)
         VALUES (?, (SELECT id FROM organizations LIMIT 1), ?, 'Online orders', '!', 0, ?, ?)`,
      )
      .run(id, ONLINE_ORDERS_USERNAME, now, now);
    return id;
  }

  message(id: string): RelayMessageRecord | undefined {
    const r = this.db
      .prepare<[string], MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM relay_messages WHERE id = ?`)
      .get(id);
    return r && toMessage(r);
  }

  insertMessage(r: RelayMessageRecord): void {
    this.db
      .prepare(
        `INSERT INTO relay_messages (id, branch_id, direction, kind, status, channel_code, external_order_id,
                                     order_id, payload_json, error, created_at, handled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.direction,
        r.kind,
        r.status,
        r.channelCode,
        r.externalOrderId,
        r.orderId,
        JSON.stringify(r.payload ?? null),
        r.error,
        r.createdAt,
        r.handledAt,
      );
  }

  updateMessage(
    id: string,
    c: Pick<RelayMessageRecord, 'status' | 'error' | 'orderId' | 'handledAt'>,
  ): void {
    this.db
      .prepare(
        'UPDATE relay_messages SET status = ?, error = ?, order_id = COALESCE(?, order_id), handled_at = ? WHERE id = ?',
      )
      .run(c.status, c.error, c.orderId, c.handledAt, id);
  }

  pendingOut(branchId: string, limit: number): RelayMessageRecord[] {
    return this.db
      .prepare<[string, number], MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM relay_messages
          WHERE branch_id = ? AND direction = 'OUT' AND status = 'PENDING' ORDER BY created_at, rowid LIMIT ?`,
      )
      .all(branchId, limit)
      .map(toMessage);
  }

  skipPendingOut(branchId: string, kind: string, at: Date): void {
    this.db
      .prepare(
        `UPDATE relay_messages SET status = 'SKIPPED', handled_at = ?
          WHERE branch_id = ? AND direction = 'OUT' AND status = 'PENDING' AND kind = ?`,
      )
      .run(at.toISOString(), branchId, kind);
  }

  recent(branchId: string, limit: number): RelayMessageRecord[] {
    return this.db
      .prepare<[string, number], MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM relay_messages WHERE branch_id = ? AND status <> 'SKIPPED'
          ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(branchId, limit)
      .map(toMessage);
  }

  counts(branchId: string) {
    return this.db
      .prepare<[string], { pendingOut: number; failedIn: number }>(
        `SELECT coalesce(sum(direction = 'OUT' AND status = 'PENDING'), 0) AS pendingOut,
                coalesce(sum(direction = 'IN' AND status = 'FAILED'), 0) AS failedIn
           FROM relay_messages WHERE branch_id = ?`,
      )
      .get(branchId)!;
  }
}
