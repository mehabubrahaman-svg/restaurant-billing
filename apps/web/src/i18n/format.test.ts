import { Money } from '@restroos/domain';
import { describe, expect, it } from 'vitest';
import { intlLocale } from './config';
import { formatMoney, formatNumber } from './format';

const lakh = Money.ofPaise(1_00_000_00);

describe('intlLocale', () => {
  it('pins the numbering system', () => {
    expect(intlLocale('en-IN', 'latin')).toBe('en-IN-u-nu-latn');
    expect(intlLocale('bn-IN', 'native')).toBe('bn-IN-u-nu-beng');
    expect(intlLocale('bn-IN', 'latin')).toBe('bn-IN-u-nu-latn');
    expect(intlLocale('hi-IN', 'native')).toBe('hi-IN-u-nu-deva');
    expect(intlLocale('en-IN', 'native')).toBe('en-IN-u-nu-latn');
  });

  it('formats the pseudo-locale like en-IN', () => {
    expect(intlLocale('en-XA', 'latin')).toBe('en-IN-u-nu-latn');
  });
});

describe('formatMoney', () => {
  it('uses Indian lakh grouping with the rupee sign', () => {
    expect(formatMoney(lakh, 'en-IN')).toBe('₹1,00,000.00');
    expect(formatMoney(lakh, 'hi-IN')).toBe('₹1,00,000.00');
    expect(formatMoney(Money.ofPaise(1_84_22_000), 'en-IN')).toBe('₹1,84,220.00');
  });

  it('shows Bengali digits only when asked to', () => {
    expect(formatMoney(lakh, 'bn-IN', 'native')).toContain('১,০০,০০০.০০');
    expect(formatMoney(lakh, 'bn-IN', 'latin')).toContain('1,00,000.00');
    expect(formatMoney(lakh, 'bn-IN', 'latin')).not.toMatch(/[০-৯]/);
  });

  it('shows Devanagari digits for hi-IN when asked to', () => {
    expect(formatMoney(lakh, 'hi-IN', 'native')).toContain('१,००,०००.००');
  });

  it('can omit the symbol for bill lines', () => {
    expect(formatMoney(Money.ofPaise(64_000), 'en-IN', 'latin', { symbol: false })).toBe('640.00');
  });

  it('formats paise exactly, including negatives and amounts beyond float precision', () => {
    expect(formatMoney(Money.ofPaise(5), 'en-IN')).toBe('₹0.05');
    expect(formatMoney(Money.ofPaise(-22_000), 'en-IN')).toBe('-₹220.00');
    // The largest amount Money allows (2^53 - 1 paise) still formats to the exact paisa.
    expect(
      formatMoney(Money.ofPaise(Number.MAX_SAFE_INTEGER), 'en-IN', 'latin', { symbol: false }),
    ).toBe('9,00,71,99,25,47,409.91');
  });
});

describe('formatNumber', () => {
  it('groups and localises digits', () => {
    expect(formatNumber(312, 'en-IN')).toBe('312');
    expect(formatNumber(123456, 'en-IN')).toBe('1,23,456');
    expect(formatNumber(42, 'bn-IN', 'native')).toBe('৪২');
  });
});

describe('numbers inside translated messages', () => {
  it('follow the digit preference', async () => {
    const { i18n, refreshMessageFormats } = await import('./index');
    const { usePreferencesStore } = await import('../stores/preferences-store');
    await i18n.changeLanguage('bn-IN');
    usePreferencesStore.getState().setDigits('native');
    refreshMessageFormats();
    expect(i18n.t('time.minutes', { minutes: 32 })).toBe('৩২ মিনিট');
    usePreferencesStore.getState().setDigits('latin');
    refreshMessageFormats();
    expect(i18n.t('time.minutes', { minutes: 32 })).toBe('32 মিনিট');
    await i18n.changeLanguage('en-IN');
  });
});
