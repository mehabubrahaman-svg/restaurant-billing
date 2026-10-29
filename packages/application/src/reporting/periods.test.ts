import { describe, expect, it } from 'vitest';
import { daysBetween, lastCompletePeriod, periodOf, periodsIn } from './periods';

describe('report periods', () => {
  it('groups a business date into its day, ISO week, month and financial year', () => {
    expect(periodOf('2026-10-28', 'day')).toEqual({
      key: '2026-10-28',
      from: '2026-10-28',
      to: '2026-10-28',
    });
    // 28 Oct 2026 is a Wednesday; its week runs Monday 26 Oct to Sunday 1 Nov.
    expect(periodOf('2026-10-28', 'week')).toEqual({
      key: '2026-10-26',
      from: '2026-10-26',
      to: '2026-11-01',
    });
    expect(periodOf('2026-11-01', 'week').key).toBe('2026-10-26');
    expect(periodOf('2028-02-10', 'month')).toEqual({
      key: '2028-02',
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(periodOf('2027-03-31', 'year')).toEqual({
      key: '2026-27',
      from: '2026-04-01',
      to: '2027-03-31',
    });
    expect(periodOf('2027-04-01', 'year').key).toBe('2027-28');
    expect(periodOf('2099-06-01', 'year').key).toBe('2099-00');
  });

  it('lists the periods of a range, clipped at both ends', () => {
    expect(periodsIn('2026-10-28', '2026-11-10', 'week')).toEqual([
      { key: '2026-10-26', from: '2026-10-28', to: '2026-11-01' },
      { key: '2026-11-02', from: '2026-11-02', to: '2026-11-08' },
      { key: '2026-11-09', from: '2026-11-09', to: '2026-11-10' },
    ]);
    expect(periodsIn('2026-03-15', '2026-05-02', 'month').map((p) => p.key)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    expect(periodsIn('2026-03-15', '2026-05-02', 'year')).toEqual([
      { key: '2025-26', from: '2026-03-15', to: '2026-03-31' },
      { key: '2026-27', from: '2026-04-01', to: '2026-05-02' },
    ]);
    expect(periodsIn('2026-10-28', '2026-10-27', 'day')).toEqual([]);
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31);
  });

  it('finds the last whole day, week, month and year before today', () => {
    expect(lastCompletePeriod('2026-10-28', 'day').key).toBe('2026-10-27');
    expect(lastCompletePeriod('2026-10-28', 'week')).toMatchObject({
      from: '2026-10-19',
      to: '2026-10-25',
    });
    expect(lastCompletePeriod('2026-10-28', 'month')).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(lastCompletePeriod('2026-10-28', 'year').key).toBe('2025-26');
  });
});
