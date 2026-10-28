import type { DomainEvent } from './domain-event';

/**
 * Base for aggregates. Each raised event bumps `version`. Repositories save
 * with `UPDATE … SET version = :version WHERE id = :id AND version = :persistedVersion`
 * and then call `markPersisted()`. That gives optimistic locking locally and
 * conflict detection for sync.
 */
export abstract class AggregateRoot<IdType extends string = string> {
  abstract readonly aggregateType: string;
  private pending: DomainEvent[] = [];

  private persisted: number;

  protected constructor(
    readonly id: IdType,
    private currentVersion: number,
  ) {
    this.persisted = currentVersion;
  }

  get version(): number {
    return this.currentVersion;
  }

  /** The version in the database when this instance was loaded or last saved (0 = new). */
  get persistedVersion(): number {
    return this.persisted;
  }

  markPersisted(): void {
    this.persisted = this.currentVersion;
  }

  /** Records a state change: bumps the version and queues an event. */
  protected raise<Type extends string, Payload>(
    type: Type,
    payload: Payload,
    occurredAt: Date,
  ): void {
    this.currentVersion += 1;
    this.pending.push({
      type,
      aggregateType: this.aggregateType,
      aggregateId: this.id,
      aggregateVersion: this.currentVersion,
      occurredAt,
      payload,
    });
  }

  /** Returns and clears the events raised since the last call. */
  pullEvents(): DomainEvent[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }
}
