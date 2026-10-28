import type { DevicePlatform } from '../../api/endpoints';
import { readStorage, STORAGE_KEYS, writeStorage } from '../../lib/storage';

let memoryFingerprint: string | null = null;

/**
 * A random id this browser creates once and keeps, so the Hub recognises a
 * re-pair and reuses the device record. Not a secret (the httpOnly cookie
 * is). Uses getRandomValues, which works on plain-HTTP LAN pages where
 * crypto.randomUUID is unavailable. If storage is blocked it lives for this
 * page load only.
 */
export function deviceFingerprint(): string {
  const stored = readStorage(STORAGE_KEYS.deviceFingerprint);
  if (stored !== null && stored.length >= 32) return stored;
  if (memoryFingerprint !== null) return memoryFingerprint;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  writeStorage(STORAGE_KEYS.deviceFingerprint, id);
  memoryFingerprint = id;
  return id;
}

/** Best guess from the user agent; only informs the admin's device list. */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): DevicePlatform {
  if (/Android/i.test(userAgent)) return 'ANDROID';
  if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
    return 'IPADOS';
  }
  if (/iPhone|iPod/i.test(userAgent)) return 'IOS';
  if (/Windows/i.test(userAgent)) return 'WINDOWS';
  if (/Linux|X11|CrOS/i.test(userAgent)) return 'LINUX';
  return 'OTHER';
}

/**
 * Whether the page itself is plain HTTP on the LAN: then the device should
 * install the Hub's CA so it can switch to HTTPS (needed for Web Bluetooth,
 * camera and service workers). Localhost counts as secure.
 */
export function needsCertificate(location: Pick<Location, 'protocol' | 'hostname'>): boolean {
  if (location.protocol !== 'http:') return false;
  return !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}
