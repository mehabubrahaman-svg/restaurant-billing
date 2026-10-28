import type { Clock } from '@restroos/application';

export interface DailyJob {
  stop(): void;
}

/**
 * Runs `task` once a day at a local time ("HH:MM" in `timeZone`). Checks
 * every minute rather than computing one long timeout, so it copes with
 * sleep/hibernate and clock changes on a shop PC. Runs at most once per local day.
 */
export function scheduleDaily(
  at: string,
  timeZone: string,
  clock: Clock,
  task: () => void | Promise<void>,
  onError: (error: unknown) => void,
): DailyJob {
  let lastRunDay: string | null = null;
  const timer = setInterval(() => {
    const { day, time } = localParts(clock.now(), timeZone);
    if (time < at || lastRunDay === day) return;
    lastRunDay = day;
    Promise.resolve().then(task).catch(onError);
  }, 60_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

export function localParts(instant: Date, timeZone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}
