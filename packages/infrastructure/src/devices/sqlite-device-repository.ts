import type {
  DeviceRecord,
  DeviceRepository,
  PairingCodeRecord,
  PeripheralRecord,
} from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

interface DeviceRow {
  id: string;
  branch_id: string;
  name: string;
  kind: DeviceRecord['kind'];
  fingerprint: string;
  platform: DeviceRecord['platform'];
  last_seen_at: string | null;
  paired_at: string | null;
  is_active: number;
  version: number;
}

const date = (v: string | null) => (v === null ? null : new Date(v));
const toDevice = (r: DeviceRow): DeviceRecord => ({
  id: r.id,
  branchId: r.branch_id,
  name: r.name,
  kind: r.kind,
  fingerprint: r.fingerprint,
  platform: r.platform,
  lastSeenAt: date(r.last_seen_at),
  pairedAt: date(r.paired_at),
  isActive: r.is_active === 1,
  version: r.version,
});

export class SqliteDeviceRepository implements DeviceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insertPairingCode(r: PairingCodeRecord & { codeHash: string; createdAt: Date }): void {
    this.db
      .prepare(
        `INSERT INTO pairing_codes (id, branch_id, code_hash, device_name, device_kind, expires_at, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.codeHash,
        r.deviceName,
        r.deviceKind,
        r.expiresAt.toISOString(),
        r.createdAt.toISOString(),
        r.createdBy,
      );
  }

  pairingCodeByHash(codeHash: string): PairingCodeRecord | undefined {
    const r = this.db
      .prepare<
        [string],
        {
          id: string;
          branch_id: string;
          device_name: string;
          device_kind: DeviceRecord['kind'];
          expires_at: string;
          used_at: string | null;
          created_by: string;
        }
      >('SELECT * FROM pairing_codes WHERE code_hash = ?')
      .get(codeHash);
    return (
      r && {
        id: r.id,
        branchId: r.branch_id,
        deviceName: r.device_name,
        deviceKind: r.device_kind,
        expiresAt: new Date(r.expires_at),
        usedAt: date(r.used_at),
        createdBy: r.created_by,
      }
    );
  }

  markPairingCodeUsed(id: string, deviceId: string, at: Date): void {
    const result = this.db
      .prepare(
        'UPDATE pairing_codes SET used_at = ?, used_by_device_id = ? WHERE id = ? AND used_at IS NULL',
      )
      .run(at.toISOString(), deviceId, id);
    if (result.changes === 0) throw new Error('pairing code was used concurrently');
  }

  devices(branchId: string): DeviceRecord[] {
    return this.db
      .prepare<[string], DeviceRow>(
        'SELECT * FROM devices WHERE branch_id = ? AND deleted_at IS NULL ORDER BY is_active DESC, name',
      )
      .all(branchId)
      .map(toDevice);
  }

  device(branchId: string, id: string): DeviceRecord | undefined {
    const r = this.db
      .prepare<[string, string], DeviceRow>('SELECT * FROM devices WHERE branch_id = ? AND id = ?')
      .get(branchId, id);
    return r && toDevice(r);
  }

  deviceByFingerprint(fingerprint: string): DeviceRecord | undefined {
    const r = this.db
      .prepare<[string], DeviceRow>('SELECT * FROM devices WHERE fingerprint = ?')
      .get(fingerprint);
    return r && toDevice(r);
  }

  deviceByTokenHash(tokenHash: string): DeviceRecord | undefined {
    const r = this.db
      .prepare<[string], DeviceRow>(
        'SELECT * FROM devices WHERE token_hash = ? AND is_active = 1 AND deleted_at IS NULL',
      )
      .get(tokenHash);
    return r && toDevice(r);
  }

  insertDevice(d: DeviceRecord, tokenHash: string, pairedBy: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO devices (id, branch_id, name, kind, fingerprint, platform, client_kind, last_seen_at, is_active,
                              token_hash, paired_at, paired_by, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, 'BROWSER', ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.id,
        d.branchId,
        d.name,
        d.kind,
        d.fingerprint,
        d.platform,
        at.toISOString(),
        tokenHash,
        at.toISOString(),
        pairedBy,
        at.toISOString(),
        at.toISOString(),
        d.version,
      );
  }

  updateDevice(d: DeviceRecord, tokenHash: string | null | undefined, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE devices SET branch_id = ?, name = ?, kind = ?, platform = ?, is_active = ?, paired_at = ?,
                token_hash = CASE WHEN ? THEN ? ELSE token_hash END, updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        d.branchId,
        d.name,
        d.kind,
        d.platform,
        d.isActive ? 1 : 0,
        d.pairedAt?.toISOString() ?? null,
        tokenHash === undefined ? 0 : 1,
        tokenHash ?? null,
        at.toISOString(),
        d.version,
        d.id,
        d.version - 1,
      );
    assertVersionMatched(result, 'Device', d.id);
  }

  touch(id: string, at: Date, transport: 'LOCALHOST' | 'LAN'): void {
    this.db
      .prepare('UPDATE devices SET last_seen_at = ?, last_transport = ? WHERE id = ?')
      .run(at.toISOString(), transport, id);
  }

  peripherals(branchId: string): PeripheralRecord[] {
    return this.db
      .prepare<
        [string],
        {
          id: string;
          device_id: string | null;
          name: string;
          kind: PeripheralRecord['kind'];
          connection: PeripheralRecord['connection'];
          address: string | null;
          is_active: number;
          version: number;
        }
      >('SELECT * FROM peripherals WHERE branch_id = ? AND deleted_at IS NULL ORDER BY name')
      .all(branchId)
      .map((r) => ({
        id: r.id,
        deviceId: r.device_id,
        name: r.name,
        kind: r.kind,
        connection: r.connection,
        address: r.address,
        isActive: r.is_active === 1,
        version: r.version,
      }));
  }

  peripheral(branchId: string, id: string): PeripheralRecord | undefined {
    return this.peripherals(branchId).find((p) => p.id === id);
  }

  insertPeripheral(branchId: string, r: PeripheralRecord, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO peripherals (id, branch_id, device_id, name, kind, connection, address, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        branchId,
        r.deviceId,
        r.name,
        r.kind,
        r.connection,
        r.address,
        at.toISOString(),
        at.toISOString(),
        r.version,
      );
  }

  updatePeripheral(branchId: string, r: PeripheralRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE peripherals SET device_id = ?, name = ?, kind = ?, connection = ?, address = ?, is_active = ?,
                updated_at = ?, version = ?
          WHERE id = ? AND branch_id = ? AND version = ?`,
      )
      .run(
        r.deviceId,
        r.name,
        r.kind,
        r.connection,
        r.address,
        r.isActive ? 1 : 0,
        at.toISOString(),
        r.version,
        r.id,
        branchId,
        r.version - 1,
      );
    assertVersionMatched(result, 'Peripheral', r.id);
  }
}
