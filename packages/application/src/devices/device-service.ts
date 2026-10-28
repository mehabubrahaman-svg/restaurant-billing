import { DomainError } from '@restroos/domain';
import type { TokenCodec } from '../identity/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type { Patch } from '../patch';
import { recordChanged } from '../shared-events';
import type {
  DeviceKind,
  DevicePlatform,
  DeviceRecord,
  DeviceRepository,
  PeripheralRecord,
} from './ports';

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOUCH_EVERY_MS = 60 * 1000;

export interface DeviceServiceDeps {
  readonly devices: DeviceRepository;
  readonly tokens: TokenCodec;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Uniform random integer in [0, max). */
  readonly randomInt: (max: number) => number;
}

/**
 * Pairing tablets and screens with the Hub (docs/01 §6). An admin creates a
 * one-time code (shown as a QR); the device redeems it for a long-lived device
 * token. Only a hash of either is stored.
 */
export class DeviceService {
  private readonly lastTouch = new Map<string, number>();

  constructor(private readonly d: DeviceServiceDeps) {}

  createPairingCode(input: { name: string; kind: DeviceKind }, ctx: CommandContext) {
    const code = Array.from(
      { length: 8 },
      () => CODE_ALPHABET[this.d.randomInt(CODE_ALPHABET.length)],
    ).join('');
    const now = this.d.clock.now();
    const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
    this.d.unitOfWork.run(ctx, (scope) => {
      const id = this.d.ids.next();
      this.d.devices.insertPairingCode({
        id,
        branchId: ctx.branchId,
        deviceName: input.name.trim(),
        deviceKind: input.kind,
        expiresAt,
        usedAt: null,
        codeHash: this.d.tokens.hash(code),
        createdBy: ctx.actorId!,
        createdAt: now,
      });
      scope.audit({
        action: 'device.pairing_code.create',
        entityType: 'PairingCode',
        entityId: id,
        after: input,
      });
    });
    return { code, expiresAt };
  }

  /** Redeems a pairing code. Re-pairing the same browser (same fingerprint) reuses its device record. */
  pair(
    input: { code: string; fingerprint: string; platform?: DevicePlatform | undefined },
    client: { ipAddress: string | null; correlationId: string },
  ): { device: DeviceRecord; token: string } {
    const now = this.d.clock.now();
    const code = this.d.devices.pairingCodeByHash(
      this.d.tokens.hash(input.code.trim().toUpperCase()),
    );
    if (!code || code.usedAt || code.expiresAt <= now) {
      throw new DomainError('PAIRING_CODE_INVALID', 'this pairing code is wrong, used or expired');
    }
    const { token, hash } = this.d.tokens.generate();
    const ctx: CommandContext = {
      branchId: code.branchId,
      actorId: null,
      ipAddress: client.ipAddress,
      correlationId: client.correlationId,
    };
    const device = this.d.unitOfWork.run(ctx, (scope) => {
      const existing = this.d.devices.deviceByFingerprint(input.fingerprint);
      let device: DeviceRecord;
      if (existing) {
        device = {
          ...existing,
          branchId: code.branchId,
          name: code.deviceName,
          kind: code.deviceKind,
          platform: input.platform ?? existing.platform,
          pairedAt: now,
          isActive: true,
          version: existing.version + 1,
        };
        this.d.devices.updateDevice(device, hash, now);
      } else {
        device = {
          id: this.d.ids.next(),
          branchId: code.branchId,
          name: code.deviceName,
          kind: code.deviceKind,
          fingerprint: input.fingerprint,
          platform: input.platform ?? null,
          lastSeenAt: now,
          pairedAt: now,
          isActive: true,
          version: 1,
        };
        this.d.devices.insertDevice(device, hash, code.createdBy, now);
      }
      this.d.devices.markPairingCodeUsed(code.id, device.id, now);
      scope.recordEvents([
        recordChanged(
          'DevicePaired',
          'Device',
          device.id,
          device.version,
          { name: device.name, kind: device.kind },
          now,
        ),
      ]);
      scope.audit({
        action: 'device.pair',
        entityType: 'Device',
        entityId: device.id,
        after: {
          name: device.name,
          kind: device.kind,
          platform: device.platform,
          repaired: !!existing,
        },
      });
      return device;
    });
    return { device, token };
  }

  /** The active device behind a device token, or undefined. Also records when it was last seen. */
  resolve(token: string, transport: 'LOCALHOST' | 'LAN'): DeviceRecord | undefined {
    const device = this.d.devices.deviceByTokenHash(this.d.tokens.hash(token));
    if (!device) return undefined;
    const now = this.d.clock.now();
    const last = this.lastTouch.get(device.id) ?? 0;
    if (now.getTime() - last > TOUCH_EVERY_MS) {
      this.lastTouch.set(device.id, now.getTime());
      this.d.devices.touch(device.id, now, transport);
    }
    return device;
  }

  list(branchId: string): DeviceRecord[] {
    return this.d.devices.devices(branchId);
  }

  update(
    id: string,
    patch: {
      version: number;
      name?: string | undefined;
      kind?: DeviceKind | undefined;
      isActive?: boolean | undefined;
    },
    ctx: CommandContext,
  ): DeviceRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.devices.device(ctx.branchId, id);
      if (!current) throw new DomainError('NOT_FOUND', 'device not found');
      if (current.version !== patch.version) {
        throw new DomainError(
          'VERSION_CONFLICT',
          'this device was changed by someone else; reload and try again',
        );
      }
      const next: DeviceRecord = {
        ...current,
        name: patch.name?.trim() ?? current.name,
        kind: patch.kind ?? current.kind,
        isActive: patch.isActive ?? current.isActive,
        version: current.version + 1,
      };
      if (!current.isActive && next.isActive) {
        throw new DomainError(
          'DEVICE_MUST_REPAIR',
          'an unpaired device must be paired again with a new code',
        );
      }
      const unpairing = current.isActive && !next.isActive;
      this.d.devices.updateDevice(next, unpairing ? null : undefined, this.d.clock.now());
      scope.recordEvents([
        recordChanged(
          unpairing ? 'DeviceUnpaired' : 'DeviceChanged',
          'Device',
          id,
          next.version,
          { name: next.name, kind: next.kind },
          this.d.clock.now(),
        ),
      ]);
      scope.audit({
        action: unpairing ? 'device.unpair' : 'device.update',
        entityType: 'Device',
        entityId: id,
        before: { name: current.name, kind: current.kind, isActive: current.isActive },
        after: { name: next.name, kind: next.kind, isActive: next.isActive },
      });
      return next;
    });
  }

  peripherals(branchId: string): PeripheralRecord[] {
    return this.d.devices.peripherals(branchId);
  }

  createPeripheral(
    input: Omit<PeripheralRecord, 'id' | 'isActive' | 'version'>,
    ctx: CommandContext,
  ) {
    return this.d.unitOfWork.run(ctx, (scope) => {
      if (input.deviceId) this.assertDevice(ctx.branchId, input.deviceId);
      const record: PeripheralRecord = {
        ...input,
        id: this.d.ids.next(),
        isActive: true,
        version: 1,
      };
      this.d.devices.insertPeripheral(ctx.branchId, record, this.d.clock.now());
      scope.audit({
        action: 'device.peripheral.create',
        entityType: 'Peripheral',
        entityId: record.id,
        after: record,
      });
      return record;
    });
  }

  updatePeripheral(
    id: string,
    patch: { version: number } & Patch<Omit<PeripheralRecord, 'id' | 'version'>>,
    ctx: CommandContext,
  ) {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.devices.peripheral(ctx.branchId, id);
      if (!current) throw new DomainError('NOT_FOUND', 'peripheral not found');
      if (current.version !== patch.version) {
        throw new DomainError(
          'VERSION_CONFLICT',
          'this peripheral was changed by someone else; reload and try again',
        );
      }
      const next: PeripheralRecord = { ...current, version: current.version + 1 };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && key !== 'version')
          (next as unknown as Record<string, unknown>)[key] = value;
      }
      if (next.deviceId) this.assertDevice(ctx.branchId, next.deviceId);
      this.d.devices.updatePeripheral(ctx.branchId, next, this.d.clock.now());
      scope.audit({
        action: 'device.peripheral.update',
        entityType: 'Peripheral',
        entityId: id,
        before: current,
        after: next,
      });
      return next;
    });
  }

  private assertDevice(branchId: string, id: string): void {
    if (!this.d.devices.device(branchId, id))
      throw new DomainError('NOT_FOUND', 'device not found');
  }
}
