/**
 * Per-device preferences in localStorage. Storage can be unavailable (private
 * mode, blocked site data, kiosk policies) or throw, so every access is
 * guarded and callers must work with `null`. Never store anything here that
 * must survive reliably or be shared: that belongs on the Hub.
 *
 * index.html reads some of these keys before React starts; keep them in sync.
 */
export const STORAGE_KEYS = {
  locale: 'restroos.locale',
  theme: 'restroos.theme',
  digits: 'restroos.digits',
  deviceKind: 'restroos.device-kind',
} as const;

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The preference simply is not remembered on this device.
  }
}
