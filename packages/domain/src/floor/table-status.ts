import { DomainError } from '../shared/result';

export type TableStatus =
  'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING' | 'BILLING' | 'BLOCKED';
export type ManualTableStatus = 'AVAILABLE' | 'RESERVED' | 'CLEANING' | 'BLOCKED';

/**
 * Changes staff may make by hand. OCCUPIED and BILLING belong to the order
 * lifecycle (opening an order, generating the bill) and are never set manually.
 */
const MANUAL: Readonly<Record<TableStatus, readonly ManualTableStatus[]>> = {
  AVAILABLE: ['RESERVED', 'CLEANING', 'BLOCKED'],
  RESERVED: ['AVAILABLE', 'BLOCKED'],
  CLEANING: ['AVAILABLE'],
  BLOCKED: ['AVAILABLE'],
  OCCUPIED: [],
  BILLING: [],
};

export function allowedManualTransitions(from: TableStatus): readonly ManualTableStatus[] {
  return MANUAL[from];
}

export function assertManualTransition(
  from: TableStatus,
  to: string,
): asserts to is ManualTableStatus {
  if (!(MANUAL[from] as readonly string[]).includes(to)) {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      `a table cannot go from ${from} to ${to} by hand`,
      {
        from,
        to,
      },
    );
  }
}

/** A table with guests or an open bill can't be retired or moved to another area. */
export function isTableInUse(status: TableStatus): boolean {
  return status === 'OCCUPIED' || status === 'BILLING';
}
