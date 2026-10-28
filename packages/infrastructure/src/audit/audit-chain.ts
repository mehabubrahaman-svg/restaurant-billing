import { createHash } from 'node:crypto';
import type { SqliteDatabase } from '../db/connection';
import { canonicalJson } from './canonical-json';

/** The columns of an audit_logs row that the hash covers (everything except the hashes). */
export interface AuditRecord {
  id: string;
  branch_id: string | null;
  actor_id: string | null;
  approver_id: string | null;
  device_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  ip_address: string | null;
  occurred_at: string;
}

/** hash = SHA-256(prev_hash ‖ canonical JSON of the row). The first row chains from "". */
export function auditHash(prevHash: string | null, record: AuditRecord): string {
  return createHash('sha256')
    .update(prevHash ?? '')
    .update('\n')
    .update(canonicalJson(record))
    .digest('hex');
}

export type AuditChainResult =
  | { readonly ok: true; readonly rows: number }
  | {
      readonly ok: false;
      readonly rows: number;
      readonly brokenAtId: string;
      readonly reason: string;
    };

/**
 * Recomputes the whole chain in insertion order. Any edited, removed or
 * re-ordered row breaks it. Run nightly; a failure raises a CRITICAL alert.
 */
export function verifyAuditChain(db: SqliteDatabase): AuditChainResult {
  const rows = db
    .prepare<[], AuditRecord & { prev_hash: string | null; hash: string }>(
      `SELECT id, branch_id, actor_id, approver_id, device_id, action, entity_type, entity_id,
              before_json, after_json, reason, ip_address, occurred_at, prev_hash, hash
         FROM audit_logs ORDER BY rowid`,
    )
    .iterate();

  let previous: string | null = null;
  let count = 0;
  for (const { prev_hash, hash, ...record } of rows) {
    count += 1;
    if (prev_hash !== previous) {
      return {
        ok: false,
        rows: count,
        brokenAtId: record.id,
        reason: 'prev_hash does not match previous row',
      };
    }
    if (auditHash(prev_hash, record) !== hash) {
      return {
        ok: false,
        rows: count,
        brokenAtId: record.id,
        reason: 'row content does not match its hash',
      };
    }
    previous = hash;
  }
  return { ok: true, rows: count };
}
