import type { AuditChainCheck, AuditFilter, AuditQueries, AuditRow } from '@restroos/application';
import { verifyAuditChain } from '../audit/audit-chain';
import type { SqliteDatabase } from '../db/connection';

interface Row {
  rowid: number;
  id: string;
  occurred_at: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  actor_name: string | null;
  approver_id: string | null;
  approver_name: string | null;
  device_id: string | null;
  ip_address: string | null;
  reason: string | null;
  before_json: string | null;
  after_json: string | null;
}

/** Newest first, keyset-paginated on rowid (insertion order), so pages stay stable while rows are added. */
export class SqliteAuditQueries implements AuditQueries {
  constructor(private readonly db: SqliteDatabase) {}

  page(f: AuditFilter): { data: AuditRow[]; nextCursor: string | null } {
    const where = ['(a.branch_id = @branchId OR a.branch_id IS NULL)'];
    const params: Record<string, unknown> = { branchId: f.branchId, limit: f.limit + 1 };
    const add = (clause: string, key: string, value: unknown) => {
      if (value === undefined) return;
      where.push(clause);
      params[key] = value;
    };
    add('a.entity_type = @entityType', 'entityType', f.entityType);
    add('a.entity_id = @entityId', 'entityId', f.entityId);
    add('(a.actor_id = @actorId OR a.approver_id = @actorId)', 'actorId', f.actorId);
    add("a.action LIKE @action || '%'", 'action', f.action);
    add('a.occurred_at >= @from', 'from', f.from);
    add('a.occurred_at < @to', 'to', f.to);
    add('a.rowid < @cursor', 'cursor', f.cursor === undefined ? undefined : decodeCursor(f.cursor));

    const rows = this.db
      .prepare<Record<string, unknown>, Row>(
        `SELECT a.rowid, a.id, a.occurred_at, a.action, a.entity_type, a.entity_id,
                a.actor_id, actor.full_name AS actor_name, a.approver_id, approver.full_name AS approver_name,
                a.device_id, a.ip_address, a.reason, a.before_json, a.after_json
           FROM audit_logs a
           LEFT JOIN users actor ON actor.id = a.actor_id
           LEFT JOIN users approver ON approver.id = a.approver_id
          WHERE ${where.join(' AND ')}
          ORDER BY a.rowid DESC
          LIMIT @limit`,
      )
      .all(params);

    const hasMore = rows.length > f.limit;
    const pageRows = hasMore ? rows.slice(0, f.limit) : rows;
    return {
      data: pageRows.map(toEntry),
      nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]!.rowid) : null,
    };
  }

  verifyChain(): AuditChainCheck {
    return verifyAuditChain(this.db);
  }
}

function toEntry(r: Row): AuditRow {
  return {
    id: r.id,
    occurredAt: r.occurred_at,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actor: r.actor_id ? { id: r.actor_id, fullName: r.actor_name ?? '?' } : null,
    approver: r.approver_id ? { id: r.approver_id, fullName: r.approver_name ?? '?' } : null,
    deviceId: r.device_id,
    ipAddress: r.ip_address,
    reason: r.reason,
    before: r.before_json === null ? null : (JSON.parse(r.before_json) as unknown),
    after: r.after_json === null ? null : (JSON.parse(r.after_json) as unknown),
  };
}

function encodeCursor(rowid: number): string {
  return Buffer.from(String(rowid)).toString('base64url');
}

function decodeCursor(cursor: string): number {
  const value = Number(Buffer.from(cursor, 'base64url').toString());
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
