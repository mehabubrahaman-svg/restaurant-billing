import type { Money } from '@restroos/domain';
import { intlLocale, type DigitStyle } from './config';

const cache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = cache.get(key);
  if (nf === undefined) {
    nf = new Intl.NumberFormat(locale, options);
    cache.set(key, nf);
  }
  return nf;
}

export interface MoneyFormatOptions {
  /** Show the ₹ sign (default) or just the grouped amount, as on bill lines. */
  readonly symbol?: boolean;
}

/**
 * Formats paise as rupees with Indian grouping: ₹1,00,000.00 in en-IN and
 * hi-IN, ১,০০,০০০.০০₹ in bn-IN with native digits.
 *
 * The amount goes to `Intl` as the exact decimal string from
 * `Money.toDecimalString()`, never as a float, so large or fractional values
 * cannot pick up binary rounding errors on the way to the screen.
 */
export function formatMoney(
  amount: Money,
  locale: string,
  digits: DigitStyle = 'latin',
  { symbol = true }: MoneyFormatOptions = {},
): string {
  const nf = formatter(intlLocale(locale, digits), {
    style: symbol ? 'currency' : 'decimal',
    ...(symbol ? { currency: 'INR' } : {}),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return nf.format(amount.toDecimalString() as Intl.StringNumericLiteral);
}

/** Counts, quantities, percentages: anything that is not money. */
export function formatNumber(
  value: number,
  locale: string,
  digits: DigitStyle = 'latin',
  options: Intl.NumberFormatOptions = {},
): string {
  return formatter(intlLocale(locale, digits), options).format(value);
}

/**
 * An exact decimal string ("28.35", "-0.5") with grouping and the user's
 * digits. Like money, it goes to `Intl` as a string, never as a float; up to
 * three decimals are kept unless `options` says otherwise.
 */
export function formatDecimal(
  decimal: string,
  locale: string,
  digits: DigitStyle = 'latin',
  options: Intl.NumberFormatOptions = {},
): string {
  return formatter(intlLocale(locale, digits), { maximumFractionDigits: 3, ...options }).format(
    decimal as Intl.StringNumericLiteral,
  );
}

const dateCache = new Map<string, Intl.DateTimeFormat>();

/** Date and time in the user's language and digits, e.g. "28 Oct 2026, 2:41 pm". */
export function formatDateTime(
  iso: string,
  locale: string,
  digits: DigitStyle = 'latin',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const tag = intlLocale(locale, digits);
  const key = `${tag}|${JSON.stringify(options)}`;
  let df = dateCache.get(key);
  if (df === undefined) {
    df = new Intl.DateTimeFormat(tag, options);
    dateCache.set(key, df);
  }
  return df.format(date);
}
