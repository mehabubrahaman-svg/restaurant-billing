import 'i18next';
import type enIN from './locales/en-IN.json';

// en-IN is the source catalogue: `t()` keys are checked against it at compile time.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof enIN };
  }
}
