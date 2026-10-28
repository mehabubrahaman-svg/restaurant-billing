import type { DomainEvent } from '@restroos/domain';

/** A domain event after it has been committed: it now has a global id and a local sequence number. */
export interface PersistedEvent extends DomainEvent {
  readonly id: string;
  /** Local total order (domain_events.seq). Clients use it to resume after a reconnect. */
  readonly seq: number;
  readonly branchId: string;
  readonly metadata: EventMetadata;
}

export interface EventMetadata {
  readonly actorId: string | null;
  readonly deviceId: string | null;
  readonly correlationId: string;
}

export type EventHandler = (event: PersistedEvent) => void | Promise<void>;

/**
 * In-process publish/subscribe. Events are published only after their
 * transaction commits, so handlers never see state that could be rolled back.
 */
export interface EventBus {
  publish(events: readonly PersistedEvent[]): void;
  subscribe(eventType: string | '*', handler: EventHandler): () => void;
}
