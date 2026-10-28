import { create } from 'zustand';
import type { DigitStyle } from '../i18n/config';
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';

interface PreferencesState {
  /** Latin or native digits. Becomes a branch setting once settings exist (architecture §5.8). */
  readonly digits: DigitStyle;
  setDigits(digits: DigitStyle): void;
}

export const usePreferencesStore = create<PreferencesState>()((set) => ({
  digits: readStorage(STORAGE_KEYS.digits) === 'native' ? 'native' : 'latin',
  setDigits(digits) {
    writeStorage(STORAGE_KEYS.digits, digits);
    set({ digits });
  },
}));
