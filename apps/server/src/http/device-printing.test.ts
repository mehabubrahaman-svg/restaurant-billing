import {
  BillResponseSchema,
  DEVICE_TOKEN_HEADER,
  DevicePrintJobsResponseSchema,
  PairDeviceResponseSchema,
  PairingCodeResponseSchema,
  PrintOutcomeSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { printKotsWhenFired } from '../jobs/kot-printing';
import { restaurantServer } from '../testing/restaurant';
import { signInAs, type Call } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

/** A paired tablet: its device token, and calls made from it. */
async function pairTablet(s: TestServer, admin: Call, name: string, fingerprint: string) {
  const code = PairingCodeResponseSchema.parse(
    (await admin('POST', '/devices/pairing-codes', { name, kind: 'KDS' })).json(),
  );
  const paired = PairDeviceResponseSchema.parse(
    (
      await s.app.inject({
        method: 'POST',
        url: '/api/v1/devices/pair',
        payload: { code: code.code, fingerprint },
      })
    ).json(),
  );
  const fromTablet = (method: 'GET' | 'POST', url: string, payload?: object) =>
    s.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { [DEVICE_TOKEN_HEADER]: paired.deviceToken },
      ...(payload && { payload }),
    });
  return { id: paired.device.id, token: paired.deviceToken, fromTablet };
}

const jobsOf = async (tablet: Awaited<ReturnType<typeof pairTablet>>) =>
  DevicePrintJobsResponseSchema.parse(
    (await tablet.fromTablet('GET', '/devices/me/print-jobs')).json(),
  ).data;

describe('Bluetooth printers attached to a tablet', () => {
  it('queues the KOT for the kitchen tablet, which prints it and reports back', async () => {
    const r = await restaurantServer();
    s = r.s;
    printKotsWhenFired(s.container.cradle);
    const kds = await pairTablet(s, r.admin, 'Tandoor tablet', 'k'.repeat(32));
    const other = await pairTablet(s, r.admin, 'Captain tablet', 'c'.repeat(32));
    const printer = (
      await r.admin('POST', '/printers', {
        name: 'Tandoor BT',
        connection: 'BLUETOOTH',
        address: '66:22:B3:01:4C:7A',
        purpose: 'KOT',
        paperWidthMm: 58,
        stationId: r.menu.tandoor.id,
        deviceId: kds.id,
      })
    ).json();
    expect(printer).toMatchObject({ deviceId: kds.id, connection: 'BLUETOOTH' });
    expect(await jobsOf(kds)).toEqual([]);

    const captain = await signInAs(s, r.admin, 'CAPTAIN', 'rahul');
    const order = await r.openAt(captain, r.tables.t1.id);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: r.menu.naan.id, quantity: 3 }],
    });
    await captain('POST', `/orders/${order.id}/kots`);

    let jobs: Awaited<ReturnType<typeof jobsOf>> = [];
    for (let i = 0; i < 50 && jobs.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      jobs = await jobsOf(kds);
    }
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job).toMatchObject({
      printerId: printer.id,
      printerName: 'Tandoor BT',
      connection: 'BLUETOOTH',
      address: '66:22:B3:01:4C:7A',
      paperWidthMm: 58,
    });
    const escpos = Buffer.from(job!.data, 'base64').toString('latin1');
    expect(escpos.startsWith('\x1b@')).toBe(true); // ESC @: initialise the printer
    expect(escpos).toContain('3 x Butter Naan');
    // The other tablet gets nothing and can't report this job.
    expect(await jobsOf(other)).toEqual([]);
    expect(
      (await other.fromTablet('POST', `/devices/me/print-jobs/${job!.id}/result`, { ok: true }))
        .statusCode,
    ).toBe(404);

    const done = await kds.fromTablet('POST', `/devices/me/print-jobs/${job!.id}/result`, {
      ok: true,
    });
    expect(done.statusCode).toBe(204);
    expect(await jobsOf(kds)).toEqual([]);

    // A browser that isn't a paired device can't ask.
    const anonymous = await s.app.inject({ url: '/api/v1/devices/me/print-jobs' });
    expect(anonymous.json().code).toBe('DEVICE_NOT_PAIRED');
  });

  it("prints a bill on the tablet's own printer, records failures, and drops stale jobs", async () => {
    const r = await restaurantServer();
    s = r.s;
    const pos = await pairTablet(s, r.admin, 'Counter tablet', 'p'.repeat(32));
    await r.admin('POST', '/printers', {
      name: 'Counter BLE',
      connection: 'BLE',
      address: 'DC:0D:30:9A:11:02',
      purpose: 'BILL',
      deviceId: pos.id,
    });
    const captain = await signInAs(s, r.admin, 'CAPTAIN', 'rahul');
    const cashier = await signInAs(s, r.admin, 'CASHIER', 'meera');
    const order = await r.openAt(captain, r.tables.t2.id);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: r.menu.naan.id, quantity: 1 }],
    });
    await captain('POST', `/orders/${order.id}/kots`);
    const invoice = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/invoice`, {})).json(),
    ).invoices[0]!;

    const printed = PrintOutcomeSchema.parse(
      (await cashier('POST', `/invoices/${invoice.id}/print`, {})).json(),
    );
    expect(printed).toMatchObject({ printerName: 'Counter BLE', queuedOnDevice: true });
    const [job] = await jobsOf(pos);
    expect(job).toMatchObject({ connection: 'BLE', address: 'DC:0D:30:9A:11:02' });
    expect(Buffer.from(job!.data, 'base64').toString('latin1')).toContain('TAX INVOICE');

    await pos.fromTablet('POST', `/devices/me/print-jobs/${job!.id}/result`, {
      ok: false,
      error: 'printer is off',
    });
    expect(await jobsOf(pos)).toEqual([]);
    const row = s.database.db
      .prepare<[string], { status: string; error: string }>(
        'SELECT status, error FROM device_print_jobs WHERE id = ?',
      )
      .get(job!.id);
    expect(row).toEqual({ status: 'FAILED', error: 'printer is off' });

    // A tablet that comes back after 10 minutes doesn't print stale tickets.
    await r.admin('POST', `/printers/${printed.printerId}/test`);
    expect(await jobsOf(pos)).toHaveLength(1);
    s.clock.advance(11 * 60_000);
    expect(await jobsOf(pos)).toEqual([]);
  });
});
