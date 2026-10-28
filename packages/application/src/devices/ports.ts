export type DeviceKind = 'POS' | 'CAPTAIN' | 'KDS' | 'OWNER' | 'TOKEN_DISPLAY' | 'KIOSK';
export type DevicePlatform = 'WINDOWS' | 'LINUX' | 'ANDROID' | 'IOS' | 'IPADOS' | 'OTHER';

export interface DeviceRecord {
  id: string;
  branchId: string;
  name: string;
  kind: DeviceKind;
  fingerprint: string;
  platform: DevicePlatform | null;
  lastSeenAt: Date | null;
  pairedAt: Date | null;
  isActive: boolean;
  version: number;
}

export interface PairingCodeRecord {
  id: string;
  branchId: string;
  deviceName: string;
  deviceKind: DeviceKind;
  expiresAt: Date;
  usedAt: Date | null;
  /** The admin who created the code; recorded as the one who paired the device. */
  createdBy: string;
}

export interface PeripheralRecord {
  id: string;
  deviceId: string | null;
  name: string;
  kind:
    | 'BARCODE_SCANNER'
    | 'WEIGHING_SCALE'
    | 'CUSTOMER_DISPLAY'
    | 'CASH_DRAWER'
    | 'GUEST_PAGER'
    | 'CARD_TERMINAL';
  connection: 'USB' | 'SERIAL' | 'NETWORK' | 'BLUETOOTH' | 'BLE' | 'HID';
  address: string | null;
  isActive: boolean;
  version: number;
}

export interface DeviceRepository {
  insertPairingCode(record: PairingCodeRecord & { codeHash: string; createdAt: Date }): void;
  pairingCodeByHash(codeHash: string): PairingCodeRecord | undefined;
  markPairingCodeUsed(id: string, deviceId: string, at: Date): void;

  devices(branchId: string): DeviceRecord[];
  device(branchId: string, id: string): DeviceRecord | undefined;
  deviceByFingerprint(fingerprint: string): DeviceRecord | undefined;
  /** Active devices only. */
  deviceByTokenHash(tokenHash: string): DeviceRecord | undefined;
  insertDevice(record: DeviceRecord, tokenHash: string, pairedBy: string, at: Date): void;
  /** Version-checked. `tokenHash` undefined keeps the token, null clears it (unpair). */
  updateDevice(record: DeviceRecord, tokenHash: string | null | undefined, at: Date): void;
  /** Bookkeeping only: no version bump. */
  touch(id: string, at: Date, transport: 'LOCALHOST' | 'LAN'): void;

  peripherals(branchId: string): PeripheralRecord[];
  peripheral(branchId: string, id: string): PeripheralRecord | undefined;
  insertPeripheral(branchId: string, record: PeripheralRecord, at: Date): void;
  updatePeripheral(branchId: string, record: PeripheralRecord, at: Date): void;
}
