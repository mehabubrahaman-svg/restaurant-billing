import {
  BLE_CHARACTERISTIC_UUIDS,
  BLE_SERVICE_UUID,
  MIN_ATT_MTU,
  bleHubInfoSchema,
  blePairingSchema,
  decodeJson,
  streamGzip,
  type BleHubInfo,
  type BlePairing,
  type FrameError,
} from '@restroos/contracts/ble';
import { RpcClient } from '../src/rpc-client';

/** Web Bluetooth connection to the spike Hub, wrapping an RpcClient. */

export type WriteMode = 'with-response' | 'without-response';

export interface HubLinkEvents {
  readonly onDisconnect: (at: number) => void;
  readonly onFrameError: (error: FrameError) => void;
  readonly log: (line: string) => void;
}

const toBytes = (view: DataView) =>
  new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));

export class HubLink {
  readonly client: RpcClient;
  hubInfo: BleHubInfo | undefined;
  writeMode: WriteMode = 'with-response';
  /** User override for frame sizing; otherwise the MTU the Hub reports. */
  mtuOverride: number | undefined;

  private hubInfoChar: BluetoothRemoteGATTCharacteristic | undefined;
  private pairingChar: BluetoothRemoteGATTCharacteristic | undefined;
  private cmdIn: BluetoothRemoteGATTCharacteristic | undefined;
  private evtOut: BluetoothRemoteGATTCharacteristic | undefined;

  private constructor(
    readonly device: BluetoothDevice,
    private readonly events: HubLinkEvents,
  ) {
    this.client = new RpcClient({
      mtu: MIN_ATT_MTU,
      compression: streamGzip(),
      writeFrame: (frame) => this.writeFrame(frame),
      onFrameError: events.onFrameError,
    });
    device.addEventListener('gattserverdisconnected', () => {
      const at = performance.now();
      this.client.reset('link lost');
      events.onDisconnect(at);
    });
    setInterval(() => this.client.expire(), 1_000);
  }

  /** Shows Chrome's device chooser (needs a user gesture). */
  static async choose(events: HubLinkEvents): Promise<HubLink> {
    if (!navigator.bluetooth)
      throw new Error('Web Bluetooth is not available in this browser/context');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE_UUID] }],
    });
    return new HubLink(device, events);
  }

  get connected(): boolean {
    return this.device.gatt?.connected ?? false;
  }

  /** True when the Hub exposes the command channel (BlueZ link-count mode exposes only hub-info). */
  get hasCommandChannel(): boolean {
    return this.cmdIn !== undefined && this.evtOut !== undefined;
  }

  /**
   * GATT connect + service discovery + notifications + hub-info read.
   * Returns how long the bare `gatt.connect()` took and the whole sequence.
   */
  async connect(): Promise<{ gattConnectMs: number; readyMs: number }> {
    const gatt = this.device.gatt;
    if (!gatt) throw new Error('device has no GATT server');
    const t0 = performance.now();
    await gatt.connect();
    const t1 = performance.now();
    const service = await gatt.getPrimaryService(BLE_SERVICE_UUID);
    this.hubInfoChar = await service.getCharacteristic(BLE_CHARACTERISTIC_UUIDS.hubInfo);
    this.pairingChar = await optional(service.getCharacteristic(BLE_CHARACTERISTIC_UUIDS.pairing));
    this.cmdIn = await optional(service.getCharacteristic(BLE_CHARACTERISTIC_UUIDS.cmdIn));
    this.evtOut = await optional(service.getCharacteristic(BLE_CHARACTERISTIC_UUIDS.evtOut));
    if (this.evtOut) {
      this.evtOut.addEventListener('characteristicvaluechanged', this.onNotification);
      await this.evtOut.startNotifications();
    }
    // A bare BlueZ GATT server (link-count test, RUNBOOK §5.5) serves an arbitrary value.
    if (this.hasCommandChannel) await this.readHubInfo();
    else await this.readHubInfoRaw();
    return { gattConnectMs: t1 - t0, readyMs: performance.now() - t0 };
  }

  disconnect(): void {
    this.evtOut?.removeEventListener('characteristicvaluechanged', this.onNotification);
    this.device.gatt?.disconnect();
  }

  async readHubInfo(): Promise<BleHubInfo> {
    if (!this.hubInfoChar) throw new Error('not connected');
    this.hubInfo = bleHubInfoSchema.parse(decodeJson(toBytes(await this.hubInfoChar.readValue())));
    this.client.setMtu(this.mtuOverride ?? this.hubInfo.mtu ?? MIN_ATT_MTU);
    return this.hubInfo;
  }

  /** Reads hub-info without parsing it; returns its length. */
  async readHubInfoRaw(): Promise<number> {
    if (!this.hubInfoChar) throw new Error('not connected');
    return (await this.hubInfoChar.readValue()).byteLength;
  }

  async readPairing(): Promise<BlePairing> {
    if (!this.pairingChar) throw new Error('Hub has no pairing characteristic');
    return blePairingSchema.parse(decodeJson(toBytes(await this.pairingChar.readValue())));
  }

  private readonly onNotification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (value) this.client.onFrame(toBytes(value));
  };

  private async writeFrame(frame: Uint8Array): Promise<void> {
    if (!this.cmdIn) throw new Error('Hub has no command channel');
    const value = new Uint8Array(frame); // ArrayBuffer-backed copy, as BufferSource requires
    if (this.writeMode === 'without-response') await this.cmdIn.writeValueWithoutResponse(value);
    else await this.cmdIn.writeValueWithResponse(value);
  }
}

async function optional<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch {
    return undefined;
  }
}
