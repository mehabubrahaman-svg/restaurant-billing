import { describe, expect, it } from 'vitest';
import { backupsToPrune } from './retention';

const at = (iso: string) => new Date(iso);
const scheduled = (id: string, iso: string) => ({
  id,
  kind: 'SCHEDULED' as const,
  createdAt: at(iso),
});

describe('backup retention', () => {
  it('keeps the newest 7, then the newest of each day for 30 days, then of each month for 12', () => {
    const backups = [];
    // Hourly for the last 10 hours: 7 kept, plus the last one of yesterday (IST).
    for (let h = 0; h < 10; h++) {
      backups.push(scheduled(`h${h}`, new Date(Date.UTC(2026, 9, 28, 12 + h)).toISOString()));
    }
    // One a day through September; one a month back to 2025.
    for (let d = 1; d <= 30; d++) {
      backups.push(scheduled(`d${d}`, `2026-09-${String(d).padStart(2, '0')}T15:00:00.000Z`));
    }
    backups.push(scheduled('m-2025-11', '2025-11-20T10:00:00.000Z'));
    backups.push(scheduled('m-2025-10', '2025-10-20T10:00:00.000Z'));

    const now = at('2026-10-28T21:30:00.000Z'); // 03:00 on 29 October in Kolkata
    const pruned = new Set(backupsToPrune(backups, now, 'Asia/Kolkata'));
    // h3..h9 are the newest 7; h6 (23:30 IST on the 28th) is also the 28th's last.
    expect(['h0', 'h1', 'h2'].every((id) => pruned.has(id))).toBe(true);
    expect(['h3', 'h6', 'h9'].some((id) => pruned.has(id))).toBe(false);
    // The 30 days are 30 Sep to 29 Oct; 30 Sep is also September's monthly.
    expect(pruned.has('d30')).toBe(false);
    expect(pruned.has('d29')).toBe(true);
    expect(pruned.has('d28')).toBe(true);
    expect(pruned.has('d1')).toBe(true);
    // 12 months back from October 2026 keeps November 2025, not October 2025.
    expect(pruned.has('m-2025-11')).toBe(false);
    expect(pruned.has('m-2025-10')).toBe(true);
  });

  it('keeps the newest 10 of each other kind, whatever their age', () => {
    const manual = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      kind: 'MANUAL' as const,
      createdAt: new Date(Date.UTC(2020, 0, 1 + i)),
    }));
    const preMigration = { id: 'p', kind: 'PRE_MIGRATION' as const, createdAt: at('2019-01-01') };
    expect(
      backupsToPrune([...manual, preMigration], at('2026-10-28T12:00:00Z'), 'Asia/Kolkata'),
    ).toEqual(['m1', 'm0']);
  });
});
