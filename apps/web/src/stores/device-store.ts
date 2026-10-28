import { create } from 'zustand';
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';

/** Mirrors `devices.kind` in the schema. Pairing (WP 3.4) will set this from the Hub. */
export const DEVICE_KINDS = [
  'SERVER',
  'POS',
  'CAPTAIN',
  'KDS',
  'OWNER',
  'TOKEN_DISPLAY',
  'KIOSK',
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Devices that boot straight into one portal, full screen, with no navigation (wireframes §2). */
export const FULL_SCREEN_PORTAL_PATH: Partial<Record<DeviceKind, string>> = {
  KDS: '/kitchen',
  TOKEN_DISPLAY: '/token-display',
};

function isDeviceKind(value: string | null): value is DeviceKind {
  return value !== null && (DEVICE_KINDS as readonly string[]).includes(value);
}

/**
 * Until pairing exists, a dev build accepts `?device=KDS` to try other device
 * kinds. The choice is remembered like a paired device's kind would be.
 */
function initialKind(): DeviceKind {
  if (import.meta.env.DEV) {
    const fromUrl = new URLSearchParams(window.location.search).get('device');
    if (isDeviceKind(fromUrl)) {
      writeStorage(STORAGE_KEYS.deviceKind, fromUrl);
      return fromUrl;
    }
  }
  const stored = readStorage(STORAGE_KEYS.deviceKind);
  return isDeviceKind(stored) ? stored : 'POS';
}

interface DeviceState {
  readonly kind: DeviceKind;
  /** Placeholder until devices are registered on the Hub. Data, not UI copy. */
  readonly name: string;
  setKind(kind: DeviceKind): void;
}

export const useDeviceStore = create<DeviceState>()((set) => ({
  kind: initialKind(),
  name: 'Billing Counter 1',
  setKind(kind) {
    writeStorage(STORAGE_KEYS.deviceKind, kind);
    set({ kind });
  },
}));
