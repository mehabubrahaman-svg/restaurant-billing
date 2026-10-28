import type { BackupKind } from './ports';

export interface RetentionPolicy {
  /** Newest scheduled backups kept regardless of age (the "hourly" tier). */
  readonly hourly: number;
  /** Days for which the newest scheduled backup of each day is kept. */
  readonly daily: number;
  /** Months for which the newest scheduled backup of each month is kept. */
  readonly monthly: number;
  /** Newest backups kept of each other kind (manual, pre-migration, ...). */
  readonly perOtherKind: number;
}

/** docs/01 §5.5: 7 hourly, 30 daily, 12 monthly. */
export const DEFAULT_RETENTION: RetentionPolicy = {
  hourly: 7,
  daily: 30,
  monthly: 12,
  perOtherKind: 10,
};

interface Candidate {
  readonly id: string;
  readonly kind: BackupKind;
  readonly createdAt: Date;
}

/**
 * Grandfather-father-son retention. Returns the ids to prune. Days and months
 * are calendar days in `timeZone`, so "the backup of 28 October" means the
 * restaurant's 28 October.
 */
export function backupsToPrune(
  backups: readonly Candidate[],
  now: Date,
  timeZone: string,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): string[] {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone });
  const keep = new Set<string>();
  const newestFirst = [...backups].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const scheduled = newestFirst.filter((b) => b.kind === 'SCHEDULED');
  scheduled.slice(0, policy.hourly).forEach((b) => keep.add(b.id));

  const dayCutoff = day.format(new Date(now.getTime() - policy.daily * 86_400_000));
  const monthCutoff = monthsBefore(day.format(now).slice(0, 7), policy.monthly);
  const seenDays = new Set<string>();
  const seenMonths = new Set<string>();
  for (const b of scheduled) {
    const d = day.format(b.createdAt);
    if (d > dayCutoff && !seenDays.has(d)) {
      seenDays.add(d);
      keep.add(b.id);
    }
    const m = d.slice(0, 7);
    if (m > monthCutoff && !seenMonths.has(m)) {
      seenMonths.add(m);
      keep.add(b.id);
    }
  }

  const perKind = new Map<BackupKind, number>();
  for (const b of newestFirst) {
    if (b.kind === 'SCHEDULED') continue;
    const n = perKind.get(b.kind) ?? 0;
    if (n < policy.perOtherKind) keep.add(b.id);
    perKind.set(b.kind, n + 1);
  }
  return newestFirst.filter((b) => !keep.has(b.id)).map((b) => b.id);
}

/** `YYYY-MM` that many months before `month`. */
function monthsBefore(month: string, months: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) - months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
