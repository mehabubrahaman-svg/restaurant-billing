/** `{ hi?, bn? }` as stored on menu items, categories, variants and add-ons. */
export interface NameTranslations {
  readonly hi?: string | undefined;
  readonly bn?: string | undefined;
}

/** Which translation a UI language uses: "hi-IN" → "hi"; English has none (it is `name`). */
export function translationKey(language: string): 'hi' | 'bn' | null {
  const base = language.slice(0, 2);
  return base === 'hi' || base === 'bn' ? base : null;
}

/** The name in the current UI language when one is given, else the main (English) name. */
export function localizedName(
  name: string,
  translations: NameTranslations,
  language: string,
): string {
  const key = translationKey(language);
  const translated = key === null ? undefined : translations[key]?.trim();
  return translated === undefined || translated === '' ? name : translated;
}

/** Drops empty entries, so `{ hi: '' }` is sent as `{}`. */
export function cleanTranslations(hi: string, bn: string): { hi?: string; bn?: string } {
  return {
    ...(hi.trim() === '' ? {} : { hi: hi.trim() }),
    ...(bn.trim() === '' ? {} : { bn: bn.trim() }),
  };
}
