import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/** Whole minutes from `fromIso` to `now`, never negative (device clocks drift a little). */
export function minutesSince(fromIso: string, now: number): number {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((now - from) / 60_000));
}

/** "32m", "1h 5m": short elapsed time for tiles and KOT cards, in the UI language. */
export function useElapsed(): (fromIso: string, now: number) => string {
  const { t } = useTranslation();
  return useCallback(
    (fromIso: string, now: number) => {
      const total = minutesSince(fromIso, now);
      if (total < 60) return t('time.elapsedMinutes', { minutes: total });
      return t('time.elapsedHours', {
        hours: Math.floor(total / 60),
        minutes: total % 60,
      });
    },
    [t],
  );
}
