import { Field, Input } from '@restroos/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { isCalendarDay } from '../../features/accounting/calendar-day';
import { daysBetween, monthStart } from '../../features/reports/use-day-format';
import { localIsoDate } from '../pos/bills-page';

/** The longest range the Hub reports on at once (ledgers, statements, vendor statements). */
export const MAX_RANGE_DAYS = 366;

/** Whether from..to is a range of real days, at most MAX_RANGE_DAYS long. */
export function rangeValid(from: string, to: string): boolean {
  if (!isCalendarDay(from) || !isCalendarDay(to)) return false;
  const days = daysBetween(from, to);
  return days >= 0 && days < MAX_RANGE_DAYS;
}

/**
 * Search params of a report screen (?from=&to=&asOf=…), so a ledger or a
 * statement can be bookmarked, shared and reloaded. A missing range is the
 * month so far.
 */
export function useReportParams() {
  const [params, setParams] = useSearchParams();
  const today = localIsoDate();
  const from = params.get('from') ?? monthStart(today);
  const to = params.get('to') ?? today;
  const asOfParam = params.get('asOf');
  /** ?asOf=, or today when it is missing or not a real day. */
  const asOf = asOfParam !== null && isCalendarDay(asOfParam) ? asOfParam : today;
  const update = useCallback(
    (patch: Readonly<Record<string, string | null>>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { params, today, from, to, asOf, valid: rangeValid(from, to), update };
}

/** From / to date pickers with the range check (at most 366 days, from before to). */
export function DateRangeFields({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  const { t } = useTranslation();
  const today = localIsoDate();
  const valid = rangeValid(from, to);
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Field
        label={t('accounts.range.from')}
        className="w-full sm:w-44"
        error={valid ? undefined : t('accounts.range.invalid', { max: MAX_RANGE_DAYS })}
      >
        {(p) => (
          <Input
            {...p}
            type="date"
            value={from}
            max={to === '' ? today : to}
            onChange={(e) => onChange({ from: e.target.value, to })}
          />
        )}
      </Field>
      <Field label={t('accounts.range.to')} className="w-full sm:w-44">
        {(p) => (
          <Input
            {...p}
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => onChange({ from, to: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

/** One "as of" date picker (trial balance, balance sheet, dues). */
export function AsOfField({
  value,
  onChange,
  allowFuture = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Dues can be aged as of a day ahead, to see what falls due by then. */
  allowFuture?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field label={t('accounts.range.asOf')} className="w-full sm:w-44">
      {(p) => (
        <Input
          {...p}
          type="date"
          value={value}
          {...(allowFuture ? {} : { max: localIsoDate() })}
          onChange={(e) => {
            if (e.target.value !== '') onChange(e.target.value);
          }}
        />
      )}
    </Field>
  );
}
