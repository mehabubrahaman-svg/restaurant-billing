/**
 * Spike Hub: a BLE peripheral on Linux (BlueZ adapter via @abandonware/bleno)
 * serving the RestroOS GATT service. See RUNBOOK.md before running.
 *
 *   pnpm --filter @restroos/spike-bluetooth hub -- [--name "RestroOS Spike"] [--max-mtu 517]
 *
 * bleno's HCI-socket backend serves ONE central at a time (it tracks a single
 * connection handle and only re-advertises after a disconnect). That is fine
 * for latency/throughput/reconnect; the concurrent-link limit is measured with
 * BlueZ's own GATT server instead (RUNBOOK §5).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { parseArgs } from 'node:util';
import type blenoModule from '@abandonware/bleno';
import {
  BLE_CHARACTERISTIC_UUIDS,
  BLE_PROTOCOL_VERSION,
  BLE_SERVICE_UUID,
  PAIRING_NONCE_ROTATION_MS,
  bleHubInfoSchema,
  blePairingSchema,
  createMsgIdCounter,
  encodeReadValue,
  type BleHubInfo,
  type BlePairing,
} from '@restroos/contracts/ble';
import type { HubStats } from './bench-protocol';
import { HubSession } from './hub-session';
import { spikeCaCertPath } from './spike-certs';
import { zlibGzip } from './zlib-compression';

type Bleno = typeof blenoModule;

const { values: args } = parseArgs({
  options: {
    name: { type: 'string', default: 'RestroOS Spike' },
    'max-mtu': { type: 'string', default: '517' },
    port: { type: 'string', default: '7400' },
  },
});

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

async function loadBleno(): Promise<Bleno> {
  try {
    const mod = await import('@abandonware/bleno');
    return mod.default;
  } catch (error) {
    console.error(
      'Could not load @abandonware/bleno (native module not built?). See RUNBOOK.md §2.\n',
      error,
    );
    process.exit(1);
  }
}

function lanUrls(port: string): string[] {
  const urls: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`https://${a.address}:${port}`);
    }
  }
  return (urls.length > 0 ? urls : [`https://restro.local:${port}`]).slice(0, 3);
}

/** SHA-256 of the spike CA (if `serve-web --https` created one), else a placeholder. */
function caFingerprint(): string {
  const path = spikeCaCertPath();
  if (!existsSync(path)) return '0'.repeat(64);
  const pem = readFileSync(path, 'utf8');
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  return createHash('sha256').update(der).digest('hex');
}

async function main(): Promise<void> {
  const bleno = await loadBleno();
  const { Characteristic, PrimaryService } = bleno;
  const hubId = randomUUID();
  const startedAt = new Date().toISOString();
  const nextMsgId = createMsgIdCounter();
  const maxMtu = Number(args['max-mtu']);

  // bleno caps the ATT MTU at 256 by default; the spike wants to see what the
  // tablets actually negotiate. Private field, guarded: a no-op if it moves.
  const gatt = (bleno as unknown as { _bindings?: { _gatt?: { maxMtu?: number } } })._bindings
    ?._gatt;
  if (gatt && typeof gatt.maxMtu === 'number') gatt.maxMtu = maxMtu;
  else log('warning: could not raise bleno maxMtu; MTU is capped at 256');

  let mtu = 23;
  let session: HubSession | undefined;
  let notifier: ((data: Buffer) => void) | undefined;
  let totalConnections = 0;

  // ---- pairing nonce, rotated every 60 s --------------------------------
  let pairing: BlePairing;
  const rotatePairing = () => {
    pairing = blePairingSchema.parse({
      hubId,
      nonce: randomBytes(16).toString('base64url'),
      expiresAt: Date.now() + PAIRING_NONCE_ROTATION_MS,
    });
    log(`pairing nonce rotated: ${pairing.nonce}`);
  };
  rotatePairing();
  setInterval(rotatePairing, PAIRING_NONCE_ROTATION_MS).unref();

  const hubInfo = (): BleHubInfo =>
    bleHubInfoSchema.parse({
      hubId,
      name: args.name.slice(0, 24),
      urls: lanUrls(args.port),
      caFingerprint: caFingerprint(),
      protocol: BLE_PROTOCOL_VERSION,
      mtu,
    });

  const hubStats = (): HubStats => ({
    startedAt,
    backend: 'bleno-hci (one central at a time)',
    connections: session ? [session.stats()] : [],
    totalConnections,
  });

  /**
   * A readable JSON characteristic. Values longer than MTU − 1 are fetched by
   * the central with Read Blob requests at increasing offsets; the value is
   * snapshotted at offset 0 so one read never mixes two nonces.
   */
  const jsonReadable = (uuid: string, value: () => Uint8Array) => {
    let snapshot = Buffer.alloc(0);
    return new Characteristic({
      uuid,
      properties: ['read'],
      onReadRequest: (offset, callback) => {
        if (offset === 0) snapshot = Buffer.from(value());
        if (offset > snapshot.length) {
          callback(Characteristic.RESULT_INVALID_OFFSET);
          return;
        }
        callback(Characteristic.RESULT_SUCCESS, snapshot.subarray(offset));
      },
    });
  };

  const cmdIn = new Characteristic({
    uuid: BLE_CHARACTERISTIC_UUIDS.cmdIn,
    // Both, so the page can compare write-with-response against write-without-response.
    properties: ['write', 'writeWithoutResponse'],
    onWriteRequest: (data, offset, _withoutResponse, callback) => {
      if (offset !== 0) {
        callback(Characteristic.RESULT_INVALID_OFFSET);
        return;
      }
      callback(Characteristic.RESULT_SUCCESS);
      session?.onFrame(new Uint8Array(data));
    },
  });

  const evtOut = new Characteristic({
    uuid: BLE_CHARACTERISTIC_UUIDS.evtOut,
    properties: ['notify'],
    onSubscribe: (maxValueSize, updateValueCallback) => {
      log(`evt-out subscribed (max notification value ${maxValueSize} B)`);
      notifier = updateValueCallback;
    },
    onUnsubscribe: () => {
      log('evt-out unsubscribed');
      notifier = undefined;
    },
  });

  const service = new PrimaryService({
    uuid: BLE_SERVICE_UUID,
    characteristics: [
      jsonReadable(BLE_CHARACTERISTIC_UUIDS.hubInfo, () => encodeReadValue(hubInfo())),
      jsonReadable(BLE_CHARACTERISTIC_UUIDS.pairing, () => encodeReadValue(pairing)),
      cmdIn,
      evtOut,
    ],
  });

  bleno.on('stateChange', (state) => {
    log(`adapter state: ${state}`);
    if (state === 'poweredOn') {
      bleno.startAdvertising(args.name, [BLE_SERVICE_UUID], (error) => {
        if (error) log(`advertising failed: ${error.message}`);
      });
    } else {
      bleno.stopAdvertising();
    }
  });

  bleno.on('advertisingStart', (error) => {
    if (error) {
      log(`advertising error: ${error.message}`);
      return;
    }
    log(`advertising "${args.name}" with service ${BLE_SERVICE_UUID}`);
    bleno.setServices([service], (e) => e && log(`setServices failed: ${e.message}`));
  });

  bleno.on('accept', (address) => {
    totalConnections++;
    mtu = 23;
    const id = `link-${totalConnections}`;
    log(`central connected: ${address} (${id})`);
    session = new HubSession({
      id,
      address,
      mtu: () => mtu,
      nextMsgId,
      compression: zlibGzip,
      hubStats,
      disconnect: () => bleno.disconnect(),
      log,
      notify: async (frame) => {
        if (!notifier) throw new Error('central has not subscribed to evt-out');
        notifier(Buffer.from(frame));
        // Yield so a long `source` burst does not starve HCI event handling.
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    });
  });

  bleno.on('mtuChange', (newMtu) => {
    mtu = newMtu;
    log(`ATT MTU negotiated: ${newMtu}${session ? ` (${session.stats().id})` : ''}`);
  });

  bleno.on('disconnect', (address) => {
    if (session) {
      log(`central disconnected: ${address} ${JSON.stringify(session.stats())}`);
      session.close();
    }
    session = undefined;
    notifier = undefined;
  });

  setInterval(() => session?.tick(), 1_000).unref();
  log(`hub ${hubId} starting (bleno platform ${bleno.platform}, max MTU ${maxMtu})`);
}

void main();
