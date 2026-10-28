import type { Kot, KotStatus } from '@restroos/contracts';
import type { KotTarget } from '../../api/endpoints';

/** Above this share of the target time a card turns amber (wireframes §6). */
export const WARN_RATIO = 0.8;

/** `normal` (neutral), `warn` (amber, > 80% of target), `late` (red + pulse, past target). */
export type KotUrgency = 'normal' | 'warn' | 'late';

/**
 * How urgent a ticket looks at `now`. The target is `targetReadyAt − firedAt`
 * (the longest prep time on the ticket). READY tickets stop the clock. The
 * Hub's `kitchen.kot.delayed` flag also makes a card late, in case this
 * screen's clock runs slow.
 */
export function kotUrgency(
  kot: Pick<Kot, 'status' | 'firedAt' | 'targetReadyAt'>,
  now: number,
  flaggedDelayed = false,
): KotUrgency {
  if (kot.status === 'READY' || kot.status === 'SERVED' || kot.status === 'CANCELLED') {
    return 'normal';
  }
  const fired = Date.parse(kot.firedAt);
  const target = Date.parse(kot.targetReadyAt);
  if (flaggedDelayed || now > target) return 'late';
  const span = target - fired;
  if (span > 0 && now - fired > WARN_RATIO * span) return 'warn';
  return 'normal';
}

/** The board's columns, left to right, and the one action each card offers. */
export const KDS_COLUMNS: readonly { status: KotStatus; next: KotTarget }[] = [
  { status: 'NEW', next: 'ACCEPTED' },
  { status: 'ACCEPTED', next: 'COOKING' },
  { status: 'COOKING', next: 'READY' },
  { status: 'READY', next: 'SERVED' },
];

/** Oldest first within a column, higher priority above. */
export function byAge(a: Kot, b: Kot): number {
  return b.priority - a.priority || Date.parse(a.firedAt) - Date.parse(b.firedAt);
}
