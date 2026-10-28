import { invariant } from './result';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The restaurant's trading day, "YYYY-MM-DD". A trading day can run past
 * midnight: with a 04:00 day start, an order at 01:30 on the 29th belongs to
 * the 28th. Reports, order numbers and KOT numbers group by this date.
 */
export class BusinessDate {
  private constructor(readonly value: string) {}

  static parse(value: string): BusinessDate {
    const match = DATE_RE.exec(value);
    invariant(match !== null, 'DATE_INVALID', `invalid date: "${value}"`);
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const probe = new Date(Date.UTC(y, m - 1, d));
    invariant(
      probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d,
      'DATE_INVALID',
      `no such date: "${value}"`,
    );
    return new BusinessDate(value);
  }

  /**
   * @param instant   the moment something happened
   * @param timeZone  IANA zone of the branch, e.g. "Asia/Kolkata"
   * @param dayStartsAt local "HH:MM" when the trading day rolls over (default "04:00")
   */
  static at(instant: Date, timeZone: string, dayStartsAt = '04:00'): BusinessDate {
    const cutoff = /^(\d{2}):(\d{2})$/.exec(dayStartsAt);
    invariant(cutoff !== null, 'DATE_INVALID', `invalid day start: "${dayStartsAt}"`);
    const cutoffMinutes = Number(cutoff[1]) * 60 + Number(cutoff[2]);
    const shifted = new Date(instant.getTime() - cutoffMinutes * 60_000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(shifted);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return BusinessDate.parse(`${get('year')}-${get('month')}-${get('day')}`);
  }

  addDays(days: number): BusinessDate {
    const [y, m, d] = this.value.split('-').map(Number) as [number, number, number];
    const next = new Date(Date.UTC(y, m - 1, d + days));
    return BusinessDate.parse(next.toISOString().slice(0, 10));
  }

  /** Indian financial year (April–March), e.g. "2026-27". Used in invoice numbers. */
  fiscalYear(): string {
    const [y, m] = this.value.split('-').map(Number) as [number, number];
    const start = m >= 4 ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  }

  compare(other: BusinessDate): -1 | 0 | 1 {
    return this.value < other.value ? -1 : this.value > other.value ? 1 : 0;
  }

  equals(other: BusinessDate): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
