import { create } from 'zustand';
import { readStorage, STORAGE_KEYS, writeStorage } from '../../lib/storage';
import type { DeviceKind } from '../../stores/device-store';

export const THEMES = ['system', 'light', 'dark', 'high-contrast'] as const;
export type ThemePreference = (typeof THEMES)[number];

function isTheme(value: string | null): value is ThemePreference {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

interface ThemeState {
  /** `null` until someone picks a theme on this device. */
  readonly preference: ThemePreference | null;
  setPreference(preference: ThemePreference): void;
}

export const useThemeStore = create<ThemeState>()((set) => {
  const stored = readStorage(STORAGE_KEYS.theme);
  return {
    preference: isTheme(stored) ? stored : null,
    setPreference(preference) {
      writeStorage(STORAGE_KEYS.theme, preference);
      set({ preference });
    },
  };
});

/** Kitchen screens default to dark (less glare); everything else follows the OS. */
export function effectiveTheme(
  preference: ThemePreference | null,
  deviceKind: DeviceKind,
): ThemePreference {
  return preference ?? (deviceKind === 'KDS' ? 'dark' : 'system');
}

/** `system` removes the attribute so `prefers-color-scheme` decides. */
export function applyTheme(theme: ThemePreference, root: HTMLElement = document.documentElement) {
  if (theme === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = theme;
}
