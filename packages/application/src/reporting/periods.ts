/** How a report groups business days: by day, ISO week (Monday first), month or Indian financial year. */
export type PeriodGrouping = 'day' | 'week' | 'month' | 'year';

export interface Period {
  /** "2026-10-28", "2026-10-26" (the week's Monday), "2026-10" or "2026-27". */
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = toDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Days from `from` to `to`, both included; 0 when `to` is before `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1);
}

/** The whole period a business date falls in (not clipped to a report's range). */
export function periodOf(date: string, grouping: PeriodGrouping): Period {
  const [y, m] = date.split('-').map(Number) as [number, number];
  switch (grouping) {
    case 'day':
      return { key: date, from: date, to: date };
    case 'week': {
      const monday = addDays(date, -((toDate(date).getUTCDay() + 6) % 7));
      return { key: monday, from: monday, to: addDays(monday, 6) };
    }
    case 'month': {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const month = date.slice(0, 7);
      return { key: month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
    }
    case 'year': {
      const start = m >= 4 ? y : y - 1;
      return {
        key: `${start}-${String((start + 1) % 100).padStart(2, '0')}`,
        from: `${start}-04-01`,
        to: `${start + 1}-03-31`,
      };
    }
  }
}

/** Every period that touches [from, to], in order, clipped to the range. */
export function periodsIn(from: string, to: string, grouping: PeriodGrouping): Period[] {
  const out: Period[] = [];
  for (let date = from; date <= to;) {
    const p = periodOf(date, grouping);
    out.push({ key: p.key, from: p.from < from ? from : p.from, to: p.to > to ? to : p.to });
    date = addDays(p.to, 1);
  }
  return out;
}

/** The last whole period that ended before `today` (for scheduled reports). */
export function lastCompletePeriod(today: string, grouping: PeriodGrouping): Period {
  return periodOf(addDays(periodOf(today, grouping).from, -1), grouping);
}
