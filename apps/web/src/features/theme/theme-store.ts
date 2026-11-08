import { create } from 'zustand';
import { readStorage, STORAGE_KEYS, writeStorage } from '../../lib/storage';
import type { DeviceKind } from '../../stores/device-store';

export const THEMES = ['system', 'light', 'dark', 'high-contrast'] as const;
export type ThemePreference = (typeof THEMES)[number];

/** Text size on this device; `default` is the scale as designed (docs/13). */
export const TEXT_SIZES = ['default', 'large', 'xlarge'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

function isTheme(value: string | null): value is ThemePreference {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

function isTextSize(value: string | null): value is TextSize {
  return value !== null && (TEXT_SIZES as readonly string[]).includes(value);
}

interface ThemeState {
  /** `null` until someone picks a theme on this device. */
  readonly preference: ThemePreference | null;
  readonly textSize: TextSize;
  setPreference(preference: ThemePreference): void;
  setTextSize(size: TextSize): void;
}

export const useThemeStore = create<ThemeState>()((set) => {
  const stored = readStorage(STORAGE_KEYS.theme);
  const storedSize = readStorage(STORAGE_KEYS.textSize);
  return {
    preference: isTheme(stored) ? stored : null,
    textSize: isTextSize(storedSize) ? storedSize : 'default',
    setPreference(preference) {
      writeStorage(STORAGE_KEYS.theme, preference);
      set({ preference });
    },
    setTextSize(textSize) {
      writeStorage(STORAGE_KEYS.textSize, textSize);
      set({ textSize });
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

/** `default` removes the attribute so the stylesheet's own size applies. */
export function applyTextSize(size: TextSize, root: HTMLElement = document.documentElement) {
  if (size === 'default') delete root.dataset['textSize'];
  else root.dataset['textSize'] = size;
}
