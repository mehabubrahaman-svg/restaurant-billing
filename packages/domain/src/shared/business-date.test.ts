import { describe, expect, it } from 'vitest';
import { BusinessDate } from './business-date';
import { DomainError } from './result';

const IST = 'Asia/Kolkata';

describe('BusinessDate', () => {
  it('uses the local date during trading hours', () => {
    // 2026-10-28 20:00 IST = 14:30 UTC
    expect(BusinessDate.at(new Date('2026-10-28T14:30:00Z'), IST).value).toBe('2026-10-28');
  });

  it('keeps after-midnight orders on the previous trading day', () => {
    // 2026-10-29 01:30 IST = 2026-10-28 20:00 UTC
    expect(BusinessDate.at(new Date('2026-10-28T20:00:00Z'), IST).value).toBe('2026-10-28');
  });

  it('rolls over at the configured day start', () => {
    // 2026-10-29 04:00 IST = 2026-10-28 22:30 UTC
    expect(BusinessDate.at(new Date('2026-10-28T22:30:00Z'), IST).value).toBe('2026-10-29');
    expect(BusinessDate.at(new Date('2026-10-28T22:29:00Z'), IST).value).toBe('2026-10-28');
    expect(BusinessDate.at(new Date('2026-10-28T20:00:00Z'), IST, '00:00').value).toBe(
      '2026-10-29',
    );
  });

  it('computes the Indian financial year', () => {
    expect(BusinessDate.parse('2026-10-28').fiscalYear()).toBe('2026-27');
    expect(BusinessDate.parse('2027-03-31').fiscalYear()).toBe('2026-27');
    expect(BusinessDate.parse('2027-04-01').fiscalYear()).toBe('2027-28');
    expect(BusinessDate.parse('2099-06-01').fiscalYear()).toBe('2099-00');
  });

  it('adds days across month and year ends', () => {
    expect(BusinessDate.parse('2026-12-31').addDays(1).value).toBe('2027-01-01');
    expect(BusinessDate.parse('2028-03-01').addDays(-1).value).toBe('2028-02-29');
  });

  it.each(['2026-02-30', '2026-13-01', '26-10-28', 'today'])('rejects "%s"', (input) => {
    expect(() => BusinessDate.parse(input)).toThrow(DomainError);
  });
});
