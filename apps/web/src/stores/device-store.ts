import type { Device } from '@restroos/contracts';
import { create } from 'zustand';
import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';

/**
 * Mirrors `devices.kind` in the schema. `SERVER` is the Hub PC itself: it is
 * never paired (it *is* the Hub), so only the dev override can choose it.
 */
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

/**
 * - `checking`: asking the Hub (GET /devices/me) on start-up.
 * - `paired`: the Hub knows this browser; `kind` and `name` come from it.
 * - `unpaired`: the Hub does not know this browser (PIN sign-in is off).
 * - `unknown`: the Hub could not be asked; the last known kind is used.
 */
export type PairingStatus = 'checking' | 'paired' | 'unpaired' | 'unknown';

export function isDeviceKind(value: string | null): value is DeviceKind {
  return value !== null && (DEVICE_KINDS as readonly string[]).includes(value);
}

/**
 * Dev builds accept `?device=KDS` to try another device kind without pairing;
 * it is remembered until `?device=auto`. Production builds ignore it: there
 * the Hub decides.
 */
function devOverride(): DeviceKind | null {
  if (!import.meta.env.DEV) return null;
  const fromUrl = new URLSearchParams(window.location.search).get('device');
  if (fromUrl === 'auto') {
    removeStorage(STORAGE_KEYS.deviceKindOverride);
    return null;
  }
  if (isDeviceKind(fromUrl)) {
    writeStorage(STORAGE_KEYS.deviceKindOverride, fromUrl);
    return fromUrl;
  }
  const stored = readStorage(STORAGE_KEYS.deviceKindOverride);
  return isDeviceKind(stored) ? stored : null;
}

/** The kind the Hub gave us last time, so a KDS still starts dark and full screen. */
function lastKnownKind(): DeviceKind {
  const stored = readStorage(STORAGE_KEYS.deviceKind);
  return isDeviceKind(stored) ? stored : 'POS';
}

interface DeviceState {
  readonly kind: DeviceKind;
  /** The name the admin gave this device on the Hub; null until paired. Data, not UI copy. */
  readonly name: string | null;
  readonly status: PairingStatus;
  /** Dev-only `?device=` choice; wins over the Hub's answer. */
  readonly override: DeviceKind | null;
  /** The Hub knows this device (GET /devices/me, or a successful pairing). */
  adopt(device: Pick<Device, 'kind' | 'name'>): void;
  /** The Hub does not know this device (404), or unpaired it. */
  markUnpaired(): void;
  /** The Hub could not be asked: keep the last known kind. */
  markUnknown(): void;
}

const initialOverride = devOverride();

export const useDeviceStore = create<DeviceState>()((set, get) => ({
  kind: initialOverride ?? lastKnownKind(),
  name: null,
  status: 'checking',
  override: initialOverride,
  adopt(device) {
    // The Hub is the source of truth; remember its answer for the next cold start.
    writeStorage(STORAGE_KEYS.deviceKind, device.kind);
    set({ kind: get().override ?? device.kind, name: device.name, status: 'paired' });
  },
  markUnpaired() {
    removeStorage(STORAGE_KEYS.deviceKind);
    set({ kind: get().override ?? 'POS', name: null, status: 'unpaired' });
  },
  markUnknown() {
    set({ status: 'unknown' });
  },
}));

/** After pairing, the Hub's kind must win, so a leftover dev override is dropped. */
export function clearDeviceOverride(): void {
  removeStorage(STORAGE_KEYS.deviceKindOverride);
  useDeviceStore.setState({ override: null });
}
