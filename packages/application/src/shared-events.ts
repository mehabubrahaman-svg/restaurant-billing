import type { DomainEvent } from '@restroos/domain';

/**
 * Event for simple versioned records (settings, tax groups, printers) that
 * don't warrant a full aggregate class.
 */
export function recordChanged(
  type: string,
  aggregateType: string,
  aggregateId: string,
  version: number,
  payload: unknown,
  occurredAt: Date,
): DomainEvent {
  return { type, aggregateType, aggregateId, aggregateVersion: version, payload, occurredAt };
}
