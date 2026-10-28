import { useCallback } from 'react';
import { useFormat } from '../../i18n/use-format';

/**
 * Formats a business date (YYYY-MM-DD) in the user's language. The date is a
 * calendar day, not an instant, so it is read and shown in UTC: the device's
 * time zone can never move it to the day before.
 */
export function useDayFormat() {
  const format = useFormat();
  return useCallback(
    (date: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) =>
      format.dateTime(`${date}T00:00:00Z`, { ...options, timeZone: 'UTC' }),
    [format],
  );
}

/** Whether `value` is a real calendar day written YYYY-MM-DD (the Hub refuses 2026-09-31). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/** Whole days from `from` to `to` (YYYY-MM-DD), inclusive of neither: 0 for the same day. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The first day of the date's month (YYYY-MM-01). */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
