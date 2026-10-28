import { BillResponseSchema, PrintDocumentSchema, PrintOutcomeSchema } from '@restroos/contracts';
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { printKotsWhenFired } from '../jobs/kot-printing';
import { restaurantServer } from '../testing/restaurant';
import { signInAs, type Call } from '../testing/staff';
import { ADMIN, type TestServer } from '../testing/test-server';

let s: TestServer | undefined;
const printers: Server[] = [];
afterEach(async () => {
  for (const p of printers.splice(0)) p.close();
  await s?.close();
});

/** A thermal printer on the LAN (raw TCP), recording every job it receives. */
async function fakePrinter() {
  const jobs: Buffer[] = [];
  const server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('end', () => jobs.push(Buffer.concat(chunks)));
  });
  printers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = `127.0.0.1:${(server.address() as { port: number }).port}`;
  const waitForJobs = async (n: number) => {
    for (let i = 0; i < 100 && jobs.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    return jobs.map((j) => j.toString('latin1'));
  };
  return { address, jobs, waitForJobs };
}

async function setup() {
  const r = await restaurantServer();
  s = r.s;
  const captain = await signInAs(r.s, r.admin, 'CAPTAIN', 'rahul');
  const cashier = await signInAs(r.s, r.admin, 'CASHIER', 'meera');
  const addPrinter = async (call: Call, body: object) =>
    (await call('POST', '/printers', body)).json() as { id: string };
  const billedOrder = async () => {
    const order = await r.openAt(captain, r.tables.t1.id);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [
        {
          menuItemId: r.menu.biryani.id,
          variantId: r.menu.full.id,
          quantity: 2,
          specialNote: 'Less spicy',
          addons: [{ addonId: r.menu.raita.id }],
        },
        { menuItemId: r.menu.naan.id, quantity: 4 },
      ],
    });
    await captain('POST', `/orders/${order.id}/kots`);
    return BillResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/invoice`, {})).json(),
    ).invoices[0]!;
  };
  return { ...r, captain, cashier, addPrinter, billedOrder };
}

describe('printing', () => {
  it('prints the bill once as the original, then DUPLICATE copies', async () => {
    const { admin, cashier, addPrinter, billedOrder } = await setup();
    const printer = await fakePrinter();
    await addPrinter(admin, {
      name: 'Counter',
      connection: 'NETWORK',
      address: printer.address,
      purpose: 'BILL',
    });
    const invoice = await billedOrder();

    const first = PrintOutcomeSchema.parse(
      (await cashier('POST', `/invoices/${invoice.id}/print`, {})).json(),
    );
    expect(first).toMatchObject({ printerName: 'Counter', mode: 'TEXT' });
    const [slip] = await printer.waitForJobs(1);
    expect(slip).toContain('TAX INVOICE');
    expect(slip).toContain('KOL1/2026-27/000001');
    expect(slip).toContain('2 x Chicken Biryani (Full) + Raita');
    expect(slip).toContain('CGST @ 2.5% on 960.00');
    expect(slip).toMatch(/TOTAL\s+Rs\.1,008\.00/);
    expect(slip).not.toContain('DUPLICATE');
    expect(slip!.endsWith('\x1d\x56\x42\x00')).toBe(true); // paper cut

    // Cashiers may reprint (billing.reprint); a captain-run counter without it would need approval.
    expect((await cashier('POST', `/invoices/${invoice.id}/print`, {})).statusCode).toBe(200);
    const jobs = await printer.waitForJobs(2);
    expect(jobs[1]).toContain('*** DUPLICATE ***');
    expect((await cashier('GET', `/invoices/${invoice.id}`)).json().printCount).toBe(2);
  });

  it('prints each KOT on its station’s printer when it is fired', async () => {
    const { admin, captain, menu, tables, openAt, addPrinter, s } = await setup();
    printKotsWhenFired(s.container.cradle);
    const kitchen = await fakePrinter();
    const tandoor = await fakePrinter();
    await addPrinter(admin, {
      name: 'Kitchen',
      connection: 'NETWORK',
      address: kitchen.address,
      purpose: 'KOT',
      stationId: menu.main.id,
    });
    await addPrinter(admin, {
      name: 'Tandoor',
      connection: 'NETWORK',
      address: tandoor.address,
      purpose: 'KOT',
      paperWidthMm: 58,
      stationId: menu.tandoor.id,
    });
    const order = await openAt(captain, tables.t2.id);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [
        {
          menuItemId: menu.biryani.id,
          variantId: menu.half.id,
          quantity: 1,
          specialNote: 'Less spicy',
        },
        { menuItemId: menu.naan.id, quantity: 3 },
      ],
    });
    await captain('POST', `/orders/${order.id}/kots`);
    const [main] = await kitchen.waitForJobs(1);
    const [bread] = await tandoor.waitForJobs(1);
    expect(main).toContain('KOT 1');
    expect(main).toContain('Main Kitchen');
    // Double-size text: 24 columns on 80 mm paper, so the size wraps to the next line.
    expect(main).toContain('1 x Chicken Biryani\n(Half)');
    expect(main).toContain('** NOTE: LESS SPICY **');
    expect(bread).toContain('3 x Butter Naan');
    expect(bread).not.toContain('Biryani');

    const kots = (await captain('GET', `/orders/${order.id}`)).json().kots;
    const reprint = await captain('POST', `/kitchen/kots/${kots[0].id}/reprint`, {});
    expect(reprint.json().data).toHaveLength(1);
    expect((await kitchen.waitForJobs(2))[1]).toContain('DUPLICATE');
  });

  it('reports a printer that is off, and a missing printer', async () => {
    const { admin, cashier, addPrinter, billedOrder } = await setup();
    const invoice = await billedOrder();
    expect((await cashier('POST', `/invoices/${invoice.id}/print`, {})).json().code).toBe(
      'NO_PRINTER',
    );
    await addPrinter(admin, {
      name: 'Counter',
      connection: 'NETWORK',
      address: '127.0.0.1:1',
      purpose: 'BILL',
    });
    const off = await cashier('POST', `/invoices/${invoice.id}/print`, {});
    expect(off.statusCode).toBe(503);
    expect(off.json().code).toBe('PRINTER_OFFLINE');
    expect((await cashier('GET', `/invoices/${invoice.id}`)).json().printCount).toBe(0);
    const kot = (await admin('GET', `/orders/${invoice.orderId}`)).json().kots[0];
    expect((await admin('POST', `/kitchen/kots/${kot.id}/reprint`, {})).json().code).toBe(
      'NO_PRINTER',
    );
  });

  it('previews the bill as blocks and prints test pages and shift reports', async () => {
    const { admin, cashier, addPrinter, billedOrder } = await setup();
    const invoice = await billedOrder();
    const preview = PrintDocumentSchema.parse(
      (await cashier('GET', `/invoices/${invoice.id}/receipt`)).json(),
    );
    expect(preview.blocks).toContainEqual({
      kind: 'row',
      left: 'TOTAL',
      right: '₹1,008.00',
      bold: true,
      size: 2,
    });

    const printer = await fakePrinter();
    const created = await addPrinter(admin, {
      name: 'Counter',
      connection: 'NETWORK',
      address: printer.address,
      purpose: 'BILL',
    });
    expect((await admin('POST', `/printers/${created.id}/test`)).json()).toMatchObject({
      mode: 'TEXT',
    });
    const shift = (await cashier('POST', '/cash-shifts', { openingFloat: 100000 })).json();
    expect((await cashier('POST', `/cash-shifts/${shift.id}/print`, {})).statusCode).toBe(200);
    const jobs = await printer.waitForJobs(2);
    expect(jobs[0]).toContain('RestroOS test print');
    expect(jobs[1]).toContain('X REPORT');

    expect((await admin('POST', '/reports/day-end/print', {})).statusCode).toBe(200);
    const dayEnd = (await printer.waitForJobs(3))[2]!;
    expect(dayEnd).toContain('DAY-END REPORT');
    expect(dayEnd).toContain('Business date 2026-10-28');
    void ADMIN;
  });
});
