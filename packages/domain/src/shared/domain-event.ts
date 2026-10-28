/**
 * Something that happened in the domain, named in the past tense
 * (`KotFired`, `InvoicePaid`). The event id and the local sequence number are
 * assigned when the event is persisted, in the same transaction as the state
 * change that produced it.
 */
export interface DomainEvent<Type extends string = string, Payload = unknown> {
  readonly type: Type;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Aggregate version after the change that raised this event. */
  readonly aggregateVersion: number;
  readonly occurredAt: Date;
  readonly payload: Payload;
}
