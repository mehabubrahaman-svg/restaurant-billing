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
  /** The kind the Hub last reported for this device (index.html reads it for the KDS theme). */
  deviceKind: 'restroos.device-kind',
  /** Dev builds only: `?device=` override. */
  deviceKindOverride: 'restroos.device-kind-override',
  /** Random id this browser sends when pairing, so the Hub recognises a re-pair. Not a secret. */
  deviceFingerprint: 'restroos.device-fingerprint',
  /** Chimes (new KOT, ready alert, token ready) switched off on this device. */
  soundMuted: 'restroos.sound-muted',
  /** The KDS station this screen shows ("all" or a station id). */
  kdsStation: 'restroos.kds-station',
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

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored, or storage is blocked: either way it is gone.
  }
}
