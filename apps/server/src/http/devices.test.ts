import {
  DeviceSchema,
  HubInfoSchema,
  PairDeviceResponseSchema,
  PairingCodeResponseSchema,
  PeripheralSchema,
} from '@restroos/contracts';
import { X509Certificate } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { caller, trail } from '../testing/staff';
import { ADMIN, createTestServer, TEST_LAN_IP, type TestServer } from '../testing/test-server';

let s: TestServer;
afterEach(async () => s?.close());

/** A tablet on the restaurant Wi-Fi, not the Hub PC. */
const TABLET = '192.168.1.57';
const FINGERPRINT = 'f'.repeat(32);

async function pairingServer() {
  s = await createTestServer();
  const admin = caller(s, (await s.login()).accessToken);
  const newCode = async (name = 'Captain tab 1', kind = 'CAPTAIN') =>
    PairingCodeResponseSchema.parse(
      (await admin('POST', '/devices/pairing-codes', { name, kind })).json(),
    );
  const fromTablet = (
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
    headers?: Record<string, string>,
  ) =>
    s.app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: TABLET,
      ...(payload && { payload }),
      ...(headers && { headers }),
    });
  const pair = async (code: string, fingerprint = FINGERPRINT) => {
    const res = await fromTablet('POST', '/devices/pair', {
      code,
      fingerprint,
      platform: 'ANDROID',
    });
    return { res, cookie: res.cookies.find((c) => c.name === 'restro_dt') };
  };
  return { admin, newCode, fromTablet, pair };
}

describe('hub discovery', () => {
  it('tells devices where the Hub is and which CA to trust', async () => {
    s = await createTestServer({ install: false });
    const info = HubInfoSchema.parse(
      (await s.app.inject({ url: '/api/v1/hub/info', remoteAddress: TABLET })).json(),
    );
    expect(info).toMatchObject({
      needsSetup: true,
      restaurantName: null,
      mdnsHost: 'restro.local',
      urls: {
        http: [`http://${TEST_LAN_IP}:7400`],
        https: ['https://restro.local:7443', `https://${TEST_LAN_IP}:7443`],
      },
    });
    const ca = await s.app.inject({ url: '/api/v1/hub/ca.crt' });
    expect(ca.headers['content-type']).toBe('application/x-x509-ca-cert');
    expect(new X509Certificate(ca.body).fingerprint256).toBe(info.caFingerprint);
  });
});

describe('device pairing', () => {
  it('pairs a tablet with a one-time code and recognises it afterwards', async () => {
    const { newCode, pair, fromTablet } = await pairingServer();
    const code = await newCode();
    expect(code.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(code.pairUrl).toBe(`http://${TEST_LAN_IP}:7400/pair?code=${code.code}`);
    expect(new Date(code.expiresAt).getTime() - s.clock.now().getTime()).toBe(10 * 60 * 1000);

    const { res, cookie } = await pair(code.code.toLowerCase());
    expect(res.statusCode).toBe(201);
    const paired = PairDeviceResponseSchema.parse(res.json());
    expect(paired.device).toMatchObject({
      name: 'Captain tab 1',
      kind: 'CAPTAIN',
      platform: 'ANDROID',
      isActive: true,
    });
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(trail(s, paired.device.id)).toMatchObject({
      audit: ['device.pair'],
      events: ['DevicePaired'],
      queued: 1,
    });

    // The cookie (browsers) and the header (native shells) both identify the device.
    const byCookie = await fromTablet('GET', '/devices/me', undefined, {
      cookie: `restro_dt=${cookie!.value}`,
    });
    expect(DeviceSchema.parse(byCookie.json()).id).toBe(paired.device.id);
    const byHeader = await fromTablet('GET', '/devices/me', undefined, {
      'x-device-token': paired.deviceToken,
    });
    expect(byHeader.json().id).toBe(paired.device.id);

    // Single use.
    expect((await pair(code.code, 'g'.repeat(32))).res.json().code).toBe('PAIRING_CODE_INVALID');
  });

  it('refuses expired codes and re-pairs the same browser in place', async () => {
    const { newCode, pair, admin } = await pairingServer();
    const old = await newCode();
    s.clock.advance(10 * 60 * 1000 + 1);
    expect((await pair(old.code)).res.json().code).toBe('PAIRING_CODE_INVALID');

    const first = PairDeviceResponseSchema.parse(
      (await pair((await newCode('KDS 1', 'KDS')).code)).res.json(),
    );
    const again = PairDeviceResponseSchema.parse(
      (await pair((await newCode('KDS Tandoor', 'KDS')).code)).res.json(),
    );
    expect(again.device.id).toBe(first.device.id);
    expect(again.device.name).toBe('KDS Tandoor');
    expect(again.deviceToken).not.toBe(first.deviceToken);
    expect((await admin('GET', '/devices')).json().data).toHaveLength(1);
  });

  it('keeps PIN sign-in to paired devices and the Hub PC', async () => {
    const { newCode, pair, fromTablet } = await pairingServer();
    const unpaired = await fromTablet('GET', '/auth/pin-users');
    expect(unpaired.statusCode).toBe(403);
    expect(unpaired.json().code).toBe('DEVICE_NOT_PAIRED');
    const pinLogin = { userId: '01900000-0000-7000-8000-000000000000', pin: ADMIN.pin };
    expect((await fromTablet('POST', '/auth/pin-login', pinLogin)).json().code).toBe(
      'DEVICE_NOT_PAIRED',
    );

    // The Hub PC itself (localhost) needs no pairing.
    expect((await s.app.inject({ url: '/api/v1/auth/pin-users' })).statusCode).toBe(200);

    const { cookie } = await pair((await newCode()).code);
    const paired = await fromTablet('GET', '/auth/pin-users', undefined, {
      cookie: `restro_dt=${cookie!.value}`,
    });
    expect(paired.statusCode).toBe(200);
    const owner = paired.json().data[0];
    const login = await fromTablet(
      'POST',
      '/auth/pin-login',
      { userId: owner.id, pin: ADMIN.pin },
      { cookie: `restro_dt=${cookie!.value}` },
    );
    expect(login.statusCode).toBe(200);

    // Sign-ins from a paired device carry its id into the audit log.
    const deviceId = s.database.db
      .prepare<[], string>(
        "SELECT device_id FROM audit_logs WHERE action = 'auth.login' ORDER BY rowid DESC",
      )
      .pluck()
      .get();
    expect(deviceId).toBe(
      (
        await fromTablet('GET', '/devices/me', undefined, { cookie: `restro_dt=${cookie!.value}` })
      ).json().id,
    );
  });

  it('unpairing a device cuts it off at once and signs out whoever is on it', async () => {
    const { newCode, pair, fromTablet, admin } = await pairingServer();
    const { res, cookie } = await pair((await newCode()).code);
    const device = PairDeviceResponseSchema.parse(res.json()).device;
    const deviceCookie = `restro_dt=${cookie!.value}`;
    const signIn = await fromTablet(
      'POST',
      '/auth/login',
      { username: ADMIN.username, password: ADMIN.password },
      { cookie: deviceCookie },
    );
    const refreshCookie = `restro_rt=${signIn.cookies.find((c) => c.name === 'restro_rt')!.value}`;
    const accessToken = signIn.json().accessToken as string;
    const off = await admin('PATCH', `/devices/${device.id}`, {
      version: device.version,
      isActive: false,
    });
    expect(off.json()).toMatchObject({ isActive: false });
    const me = await fromTablet('GET', '/devices/me', undefined, {
      cookie: `restro_dt=${cookie!.value}`,
    });
    expect(me.json().code).toBe('DEVICE_NOT_PAIRED');
    expect(
      (
        await admin('PATCH', `/devices/${device.id}`, {
          version: device.version + 1,
          isActive: true,
        })
      ).json().code,
    ).toBe('DEVICE_MUST_REPAIR');

    const refresh = await fromTablet(
      'POST',
      '/auth/refresh',
      {},
      {
        cookie: `${deviceCookie}; ${refreshCookie}`,
      },
    );
    expect(refresh.statusCode).toBe(401);
    const meAsUser = await fromTablet('GET', '/auth/me', undefined, {
      authorization: `Bearer ${accessToken}`,
    });
    expect(meAsUser.statusCode).toBe(401);
  });

  it('only admins with settings.manage can create codes', async () => {
    const { fromTablet } = await pairingServer();
    expect((await fromTablet('GET', '/hub/info')).json().restaurantName).toBe('Spice Route');
    expect(
      (await fromTablet('POST', '/devices/pairing-codes', { name: 'Rogue', kind: 'POS' }))
        .statusCode,
    ).toBe(401);
  });
});

describe('peripherals', () => {
  it('registers a Bluetooth scanner on a paired tablet', async () => {
    const { newCode, pair, admin } = await pairingServer();
    const device = PairDeviceResponseSchema.parse(
      (await pair((await newCode()).code)).res.json(),
    ).device;
    const created = await admin('POST', '/peripherals', {
      name: 'Counter scanner',
      kind: 'BARCODE_SCANNER',
      connection: 'BLE',
      deviceId: device.id,
      address: 'C4:7C:8D:6A:11:02',
    });
    expect(created.statusCode).toBe(201);
    const scanner = PeripheralSchema.parse(created.json());
    const moved = await admin('PATCH', `/peripherals/${scanner.id}`, {
      version: scanner.version,
      deviceId: null,
    });
    expect(moved.json()).toMatchObject({ deviceId: null, version: 2 });
    expect((await admin('GET', '/peripherals')).json().data).toHaveLength(1);
    expect(
      (
        await admin('POST', '/peripherals', {
          name: 'Ghost',
          kind: 'CASH_DRAWER',
          connection: 'USB',
          deviceId: '01900000-0000-7000-8000-000000000000',
        })
      ).json().code,
    ).toBe('NOT_FOUND');
  });
});
