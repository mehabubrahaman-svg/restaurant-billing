import type { DomainEvent } from '@restroos/domain';

/** Who is doing something, from where. Every command runs with one. */
export interface CommandContext {
  readonly branchId: string;
  readonly actorId: string | null;
  /** Manager who authorised a sensitive action (refund, void, discount override). */
  readonly approverId?: string | null;
  readonly deviceId?: string | null;
  readonly ipAddress?: string | null;
  /** Ties together the request, its events and its audit rows. */
  readonly correlationId: string;
}

export interface AuditEntry {
  /** `<module>.<entity>.<verb>`, e.g. `order.item.cancel`. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
}

/** What a command can record while its transaction is open. */
export interface TransactionScope {
  /** Events to persist (and queue for sync) in this transaction; published after commit. */
  recordEvents(events: readonly DomainEvent[]): void;
  audit(entry: AuditEntry): void;
}

/**
 * Runs a command atomically: state changes, domain events, audit rows and the
 * sync outbox commit together or not at all.
 *
 * `work` must be synchronous. Nothing may be awaited while the write lock is
 * held: printing, network calls and other slow I/O happen after commit, in
 * event handlers. Implementations reject a `work` that returns a promise.
 */
export interface UnitOfWork {
  run<T>(context: CommandContext, work: (scope: TransactionScope) => T): T;
}
