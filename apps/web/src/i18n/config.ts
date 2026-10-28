/** Wave-1 launch locales (architecture §5.8). Adding one is a catalogue + a Noto font. */
export const LOCALES = ['en-IN', 'hi-IN', 'bn-IN'] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en-IN';

/**
 * Dev-only pseudo-locale: English with accented letters, ~40% longer and
 * wrapped in ⟦ ⟧, so hard-coded strings, truncation and clipping are obvious.
 * `XA` is the CLDR/Android convention for pseudo-accented English.
 */
export const PSEUDO_LOCALE = 'en-XA';

/** Whether numbers use Latin digits (123) or the script's own (১২৩ / १२३). A branch setting. */
export type DigitStyle = 'latin' | 'native';

export interface LocaleOption {
  readonly code: string;
  /** Switcher label: `EN | हि | বা`. */
  readonly short: string;
  /** Endonym, used as the accessible name. Never translated. */
  readonly name: string;
}

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
  { code: 'en-IN', short: 'EN', name: 'English' },
  { code: 'hi-IN', short: 'हि', name: 'हिन्दी' },
  { code: 'bn-IN', short: 'বা', name: 'বাংলা' },
];

export const PSEUDO_OPTION: LocaleOption = { code: PSEUDO_LOCALE, short: 'XA', name: 'Pseudo' };

const NATIVE_NUMBERING: Readonly<Record<string, string>> = {
  'hi-IN': 'deva',
  'bn-IN': 'beng',
};

export function hasNativeDigits(locale: string): boolean {
  return locale in NATIVE_NUMBERING;
}

export function isSupportedLocale(value: string | null): value is AppLocale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * The BCP-47 tag handed to `Intl`, with the numbering system pinned. Pinning
 * matters both ways: CLDR's default for `bn` is already Bengali digits, so
 * Latin digits have to be asked for explicitly (`bn-IN-u-nu-latn`).
 */
export function intlLocale(locale: string, digits: DigitStyle): string {
  const base = locale === PSEUDO_LOCALE ? DEFAULT_LOCALE : locale;
  const numbering = digits === 'native' ? (NATIVE_NUMBERING[base] ?? 'latn') : 'latn';
  return `${base}-u-nu-${numbering}`;
}
