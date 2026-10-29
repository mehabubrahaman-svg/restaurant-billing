const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether a YYYY-MM-DD string is a real calendar day. The Hub refuses
 * 2026-09-31 (VALIDATION_FAILED), while `Date.parse` quietly rolls it over
 * to 1 October, so dates typed into a URL are checked here first.
 */
export function isCalendarDay(value: string): boolean {
  const match = DAY.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
