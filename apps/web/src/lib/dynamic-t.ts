import type { TFunction } from 'i18next';

/**
 * Translates a key built at runtime (e.g. from a permission code the Hub sent),
 * falling back to `fallback` when the catalogue has no entry. Typed `t()` only
 * accepts literal keys, so this is the one sanctioned escape hatch.
 */
export function tDynamic(t: TFunction, key: string, fallback: string): string {
  const translate = t as unknown as (k: string, o: { defaultValue: string }) => string;
  return translate(key, { defaultValue: fallback });
}
