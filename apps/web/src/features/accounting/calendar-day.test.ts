import { describe, expect, it } from 'vitest';
import { isCalendarDay } from './calendar-day';

describe('isCalendarDay', () => {
  it('accepts real days, leap days included', () => {
    for (const day of ['2026-10-28', '2026-01-31', '2028-02-29', '2000-02-29', '2026-12-31'])
      expect(isCalendarDay(day), day).toBe(true);
  });

  it('refuses days that roll over and anything not YYYY-MM-DD', () => {
    for (const day of [
      '2026-09-31',
      '2026-02-29',
      '1900-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-10-1',
      '28-10-2026',
      '',
    ])
      expect(isCalendarDay(day), day).toBe(false);
  });
});
