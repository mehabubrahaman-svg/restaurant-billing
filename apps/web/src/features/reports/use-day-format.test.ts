import { describe, expect, it } from 'vitest';
import { daysBetween, isCalendarDay, monthStart } from './use-day-format';

describe('business days', () => {
  it('knows a real calendar day from a well-formed impossible one', () => {
    expect(isCalendarDay('2026-10-28')).toBe(true);
    expect(isCalendarDay('2028-02-29')).toBe(true);
    // The Hub refuses these with a 422.
    expect(isCalendarDay('2026-09-31')).toBe(false);
    expect(isCalendarDay('2026-02-29')).toBe(false);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay('28-10-2026')).toBe(false);
    expect(isCalendarDay('')).toBe(false);
  });

  it('counts whole days and finds the start of the month', () => {
    expect(daysBetween('2026-10-01', '2026-10-28')).toBe(27);
    expect(daysBetween('2026-10-28', '2026-10-28')).toBe(0);
    expect(monthStart('2026-10-28')).toBe('2026-10-01');
  });
});
