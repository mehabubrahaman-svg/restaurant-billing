import type { Money } from '@restroos/domain';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreferencesStore } from '../stores/preferences-store';
import {
  formatDateTime,
  formatDecimal,
  formatMoney,
  formatNumber,
  type MoneyFormatOptions,
} from './format';

/** Number and money formatters bound to the current language and digit preference. */
export function useFormat() {
  const { i18n } = useTranslation();
  const digits = usePreferencesStore((s) => s.digits);
  const locale = i18n.language;
  return useMemo(
    () => ({
      money: (amount: Money, options?: MoneyFormatOptions) =>
        formatMoney(amount, locale, digits, options),
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        formatNumber(value, locale, digits, options),
      /** An exact decimal string, e.g. a stock quantity: "28.35". */
      decimal: (value: string, options?: Intl.NumberFormatOptions) =>
        formatDecimal(value, locale, digits, options),
      dateTime: (iso: string, options?: Intl.DateTimeFormatOptions) =>
        formatDateTime(iso, locale, digits, options),
    }),
    [locale, digits],
  );
}
