import type {
  AuditEntry,
  Clock,
  CommandContext,
  EventBus,
  IdGenerator,
  PersistedEvent,
  TransactionScope,
  UnitOfWork,
} from '@restroos/application';
import type { DomainEvent } from '@restroos/domain';
import { auditHash, type AuditRecord } from '../audit/audit-chain';
import type { SqliteDatabase } from './connection';

export interface SqliteUnitOfWorkDeps {
  readonly db: SqliteDatabase;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly eventBus: EventBus;
}

/**
 * SQLite implementation of UnitOfWork. Each `run` is one `BEGIN IMMEDIATE`
 * transaction: the write lock is taken up front, so two terminals can never
 * interleave read-then-write on the same stock or invoice sequence.
 *
 * Inside the transaction, after `work` returns, it appends the recorded events
 * to domain_events, queues each for cloud sync (transactional outbox) and
 * writes the hash-chained audit rows. Events are published only after COMMIT.
 */
export class SqliteUnitOfWork implements UnitOfWork {
  private readonly insertEvent;
  private readonly insertOutbox;
  private readonly insertAudit;
  private readonly lastAuditHash;

  constructor(private readonly deps: SqliteUnitOfWorkDeps) {
    const { db } = deps;
    this.insertEvent = db.prepare(
      `INSERT INTO domain_events (id, branch_id, aggregate_type, aggregate_id, aggregate_version,
                                  event_type, payload_json, metadata_json, occurred_at)
       VALUES (@id, @branchId, @aggregateType, @aggregateId, @aggregateVersion,
               @type, @payload, @metadata, @occurredAt)`,
    );
    this.insertOutbox = db.prepare(
      `INSERT INTO sync_queue (id, event_seq, branch_id, entity_type, entity_id, operation,
                               status, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'APPEND', 'PENDING', 0, ?, ?)`,
    );
    this.insertAudit = db.prepare(
      `INSERT INTO audit_logs (id, branch_id, actor_id, approver_id, device_id, action, entity_type,
                               entity_id, before_json, after_json, reason, ip_address, occurred_at,
                               prev_hash, hash)
       VALUES (@id, @branch_id, @actor_id, @approver_id, @device_id, @action, @entity_type,
               @entity_id, @before_json, @after_json, @reason, @ip_address, @occurred_at,
               @prev_hash, @hash)`,
    );
    this.lastAuditHash = db
      .prepare<[], string>('SELECT hash FROM audit_logs ORDER BY rowid DESC LIMIT 1')
      .pluck();
  }

  run<T>(context: CommandContext, work: (scope: TransactionScope) => T): T {
    const events: DomainEvent[] = [];
    const audits: AuditEntry[] = [];
    const scope: TransactionScope = {
      recordEvents: (e) => events.push(...e),
      audit: (entry) => audits.push(entry),
    };

    let persisted: PersistedEvent[] = [];
    const result = this.deps.db
      .transaction(() => {
        const value = work(scope);
        if (isPromiseLike(value)) {
          throw new Error('UnitOfWork work must be synchronous; do slow I/O after commit');
        }
        persisted = this.persistEvents(context, events);
        this.persistAudits(context, audits);
        return value;
      })
      .immediate();

    this.deps.eventBus.publish(persisted);
    return result;
  }

  private persistEvents(context: CommandContext, events: readonly DomainEvent[]): PersistedEvent[] {
    const now = this.deps.clock.now().toISOString();
    const metadata = {
      actorId: context.actorId,
      deviceId: context.deviceId ?? null,
      correlationId: context.correlationId,
    };
    return events.map((event) => {
      const id = this.deps.ids.next();
      const { lastInsertRowid } = this.insertEvent.run({
        id,
        branchId: context.branchId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        type: event.type,
        payload: JSON.stringify(event.payload ?? null),
        metadata: JSON.stringify(metadata),
        occurredAt: event.occurredAt.toISOString(),
      });
      const seq = Number(lastInsertRowid);
      this.insertOutbox.run(
        this.deps.ids.next(),
        seq,
        context.branchId,
        event.aggregateType,
        event.aggregateId,
        now,
        now,
      );
      return { ...event, id, seq, branchId: context.branchId, metadata };
    });
  }

  private persistAudits(context: CommandContext, audits: readonly AuditEntry[]): void {
    if (audits.length === 0) return;
    let prevHash = this.lastAuditHash.get() ?? null;
    const occurredAt = this.deps.clock.now().toISOString();
    for (const entry of audits) {
      const record: AuditRecord = {
        id: this.deps.ids.next(),
        branch_id: context.branchId,
        actor_id: context.actorId,
        approver_id: context.approverId ?? null,
        device_id: context.deviceId ?? null,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        before_json: entry.before === undefined ? null : JSON.stringify(entry.before),
        after_json: entry.after === undefined ? null : JSON.stringify(entry.after),
        reason: entry.reason ?? null,
        ip_address: context.ipAddress ?? null,
        occurred_at: occurredAt,
      };
      const hash = auditHash(prevHash, record);
      this.insertAudit.run({ ...record, prev_hash: prevHash, hash });
      prevHash = hash;
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
