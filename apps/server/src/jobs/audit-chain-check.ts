import type { AuditQueries, Clock, IdGenerator } from '@restroos/application';
import type { SqliteDatabase } from '@restroos/infrastructure';
import type { Logger } from 'pino';

/**
 * Nightly tamper check of the audit trail (docs/01 §5.4). A broken chain means
 * someone edited history outside the application: raise a CRITICAL
 * notification to every branch's admins and log it loudly.
 */
export function checkAuditChain(deps: {
  auditQueries: AuditQueries;
  db: SqliteDatabase;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}): boolean {
  const result = deps.auditQueries.verifyChain();
  if (result.ok) {
    deps.logger.info({ rows: result.rows }, 'audit chain verified');
    return true;
  }
  deps.logger.error(
    { ...result },
    'AUDIT CHAIN BROKEN: audit history was modified outside the application',
  );
  const insert = deps.db.prepare(
    `INSERT INTO notifications (id, branch_id, role_code, kind, severity, title, body, entity_type, entity_id, created_at)
     VALUES (?, ?, 'ADMIN', 'AUDIT_CHAIN_BROKEN', 'CRITICAL', ?, ?, 'AuditLog', ?, ?)`,
  );
  const branches = deps.db
    .prepare<[], string>('SELECT id FROM branches WHERE deleted_at IS NULL')
    .pluck()
    .all();
  for (const branchId of branches) {
    insert.run(
      deps.ids.next(),
      branchId,
      'Audit history was tampered with',
      `Integrity check failed at entry ${result.brokenAtId}: ${result.reason}`,
      result.brokenAtId,
      deps.clock.now().toISOString(),
    );
  }
  return false;
}
