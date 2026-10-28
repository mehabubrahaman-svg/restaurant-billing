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
