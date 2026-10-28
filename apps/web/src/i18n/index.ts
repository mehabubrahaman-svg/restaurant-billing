import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';
import { usePreferencesStore } from '../stores/preferences-store';
import { DEFAULT_LOCALE, intlLocale, isSupportedLocale, LOCALES, PSEUDO_LOCALE } from './config';
import bnIN from './locales/bn-IN.json';
import enIN from './locales/en-IN.json';
import hiIN from './locales/hi-IN.json';
import { pseudoLocalizeCatalogue } from './pseudo';

const resources: Record<string, { translation: object }> = {
  'en-IN': { translation: enIN },
  'hi-IN': { translation: hiIN },
  'bn-IN': { translation: bnIN },
};
const supportedLngs: string[] = [...LOCALES];

// Dev builds only: the bundler drops this block (and pseudo.ts) from production.
if (import.meta.env.DEV) {
  resources[PSEUDO_LOCALE] = { translation: pseudoLocalizeCatalogue(enIN) };
  supportedLngs.push(PSEUDO_LOCALE);
}

/** The device's last chosen language; anything unknown falls back to en-IN. */
function initialLocale(): string {
  const stored = readStorage(STORAGE_KEYS.locale);
  if (isSupportedLocale(stored)) return stored;
  if (import.meta.env.DEV && stored === PSEUDO_LOCALE) return stored;
  return DEFAULT_LOCALE;
}

// ICU plural rules and `{n, number}` in messages follow the digit preference too.
const icu = new ICU({
  parseLngForICU: (lng) => intlLocale(lng, usePreferencesStore.getState().digits),
});

export const i18n = i18next.createInstance();

void i18n
  .use(icu)
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLocale(),
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs,
    load: 'currentOnly',
    // Catalogues are bundled, so initialisation is synchronous: no loading flash, works offline.
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });

function syncDocumentLanguage(lng: string): void {
  document.documentElement.lang = lng;
}

syncDocumentLanguage(i18n.language);
i18n.on('languageChanged', (lng) => {
  syncDocumentLanguage(lng);
  writeStorage(STORAGE_KEYS.locale, lng);
});

/** Re-render translated text after the digit preference changes. */
export function refreshMessageFormats(): void {
  icu.clearCache();
  void i18n.changeLanguage(i18n.language);
}
