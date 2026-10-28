export interface AuditRow {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { id: string; fullName: string } | null;
  approver: { id: string; fullName: string } | null;
  deviceId: string | null;
  ipAddress: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
}

export interface AuditFilter {
  branchId: string;
  entityType?: string | undefined;
  entityId?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Opaque cursor from a previous page. */
  cursor?: string | undefined;
  limit: number;
}

export type AuditChainCheck =
  { ok: true; rows: number } | { ok: false; rows: number; brokenAtId: string; reason: string };

export interface AuditQueries {
  page(filter: AuditFilter): { data: AuditRow[]; nextCursor: string | null };
  verifyChain(): AuditChainCheck;
}
