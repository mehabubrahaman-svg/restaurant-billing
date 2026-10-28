import type { TableStatus } from '@restroos/contracts';
import type { TableState } from '@restroos/ui';
import type { ManualTableStatus } from '../../api/endpoints';

/** Contract status → the shared state chip / colour token. */
export const STATUS_CHIP: Readonly<Record<TableStatus, TableState>> = {
  AVAILABLE: 'available',
  OCCUPIED: 'occupied',
  BILLING: 'billing',
  RESERVED: 'reserved',
  CLEANING: 'cleaning',
  BLOCKED: 'blocked',
};

/**
 * Manual changes staff may make (the Hub enforces the same rule; anything
 * else is INVALID_STATE_TRANSITION). OCCUPIED and BILLING are set by orders.
 */
const TRANSITIONS: Readonly<Record<TableStatus, readonly ManualTableStatus[]>> = {
  AVAILABLE: ['RESERVED', 'CLEANING', 'BLOCKED'],
  RESERVED: ['AVAILABLE', 'BLOCKED'],
  CLEANING: ['AVAILABLE'],
  BLOCKED: ['AVAILABLE'],
  OCCUPIED: [],
  BILLING: [],
};

export function allowedTransitions(status: TableStatus): readonly ManualTableStatus[] {
  return TRANSITIONS[status];
}

/** Legend order on the floor views. */
export const STATUS_ORDER: readonly TableStatus[] = [
  'AVAILABLE',
  'OCCUPIED',
  'BILLING',
  'RESERVED',
  'CLEANING',
  'BLOCKED',
];
