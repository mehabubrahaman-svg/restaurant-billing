import {
  FireKotsResponseSchema,
  QrMenuSchema,
  QrRequestStatusResponseSchema,
  QrRequestsResponseSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

/** The guest's phone: no sign-in. */
const guest = (server: TestServer) => (method: 'GET' | 'POST', url: string, payload?: object) =>
  server.app.inject({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) });

async function qrTable() {
  const r = await restaurantServer();
  s = r.s;
  const { url } = (await r.admin('POST', `/tables/${r.tables.t1.id}/qr`)).json();
  const token = String(url).split('/qr/')[1]!;
  return { ...r, token, phone: guest(r.s) };
}

describe('QR self-ordering', () => {
  it('shows the menu, takes a guest’s order, and puts it on the table once a captain accepts', async () => {
    const { admin, menu, tables, token, phone } = await qrTable();
    const captain = await signInAs(s!, admin, 'CAPTAIN', 'rahul');

    const shown = QrMenuSchema.parse((await phone('GET', `/public/qr/${token}/menu`)).json());
    expect(shown.tableLabel).toBe(tables.t1.label);
    const naan = shown.items.find((i) => i.id === menu.naan.id)!;
    expect(naan).toMatchObject({ price: menu.naan.basePrice, isAvailable: true });
    // Guests see what to order, not how the restaurant runs.
    expect(naan).not.toHaveProperty('sku');
    expect(naan).not.toHaveProperty('kitchenStationId');
    expect((await phone('GET', '/public/qr/not-a-real-token/menu')).statusCode).toBe(404);

    const order = {
      kind: 'ORDER',
      items: [{ menuItemId: menu.naan.id, quantity: 2, note: 'extra butter' }],
      covers: 2,
      clientKey: 'phone-key-0001',
    };
    const sent = await phone('POST', `/public/qr/${token}/requests`, order);
    expect(sent.statusCode).toBe(201);
    const request = QrRequestStatusResponseSchema.parse(sent.json());
    expect(request).toMatchObject({ kind: 'ORDER', status: 'PENDING' });
    expect(request.items[0]).toMatchObject({
      name: 'Butter Naan',
      quantity: 2,
      note: 'extra butter',
    });
    // The same send again (a retry on a weak signal) is the same request.
    expect((await phone('POST', `/public/qr/${token}/requests`, order)).json().id).toBe(request.id);
    const call = QrRequestStatusResponseSchema.parse(
      (await phone('POST', `/public/qr/${token}/requests`, { kind: 'WAITER' })).json(),
    );

    const waiting = QrRequestsResponseSchema.parse(
      (await captain('GET', '/qr-requests')).json(),
    ).data;
    expect(waiting.map((w) => [w.kind, w.tableLabel])).toEqual([
      ['ORDER', tables.t1.label],
      ['WAITER', tables.t1.label],
    ]);

    // Accepted: the table gets an order (from the QR) and the kitchen a KOT.
    const accepted = FireKotsResponseSchema.parse(
      (await captain('POST', `/qr-requests/${request.id}/accept`, {})).json(),
    );
    expect(accepted.order).toMatchObject({ tableId: tables.t1.id, covers: 2 });
    expect(
      s!.database.db
        .prepare('SELECT source FROM orders WHERE id = ?')
        .pluck()
        .get(accepted.order.id),
    ).toBe('QR');
    expect(accepted.order.items).toEqual([
      expect.objectContaining({
        name: 'Butter Naan',
        quantity: 2,
        specialNote: 'extra butter',
        status: 'SENT',
      }),
    ]);
    expect(accepted.kots).toHaveLength(1);
    expect((await phone('GET', `/public/qr/${token}/requests/${request.id}`)).json()).toMatchObject(
      { status: 'ACCEPTED' },
    );
    expect((await captain('POST', `/qr-requests/${request.id}/accept`, {})).json().code).toBe(
      'QR_REQUEST_HANDLED',
    );

    // A second order goes onto the same open order.
    const more = QrRequestStatusResponseSchema.parse(
      (
        await phone('POST', `/public/qr/${token}/requests`, {
          kind: 'ORDER',
          items: [{ menuItemId: menu.naan.id, quantity: 1 }],
        })
      ).json(),
    );
    const again = FireKotsResponseSchema.parse(
      (await captain('POST', `/qr-requests/${more.id}/accept`, { fire: false })).json(),
    );
    expect(again.order.id).toBe(accepted.order.id);
    expect(again.kots).toEqual([]);
    expect(again.order.items.map((i) => i.status)).toEqual(['SENT', 'PENDING']);

    // A call is marked done; an order can't be.
    expect((await captain('POST', `/qr-requests/${call.id}/done`)).json()).toMatchObject({
      status: 'DONE',
    });
    const third = QrRequestStatusResponseSchema.parse(
      (
        await phone('POST', `/public/qr/${token}/requests`, {
          kind: 'ORDER',
          items: [{ menuItemId: menu.naan.id, quantity: 9 }],
        })
      ).json(),
    );
    expect((await captain('POST', `/qr-requests/${third.id}/done`)).json().code).toBe(
      'VALIDATION_FAILED',
    );
    await captain('POST', `/qr-requests/${third.id}/reject`, { reason: 'Kitchen is closing' });
    expect((await phone('GET', `/public/qr/${token}/requests/${third.id}`)).json()).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'Kitchen is closing',
    });
    expect(
      QrRequestsResponseSchema.parse((await captain('GET', '/qr-requests')).json()).data,
    ).toEqual([]);
  });

  it('checks what guests send, and keeps a table from flooding the captains', async () => {
    const { admin, menu, token, phone } = await qrTable();
    const kitchen = await signInAs(s!, admin, 'KITCHEN', 'ramesh');

    expect(
      (await phone('POST', `/public/qr/${token}/requests`, { kind: 'ORDER', items: [] })).json()
        .code,
    ).toBe('VALIDATION_FAILED');
    await admin('POST', `/menu-items/${menu.naan.id}/availability`, { isAvailable: false });
    const off = await phone('POST', `/public/qr/${token}/requests`, {
      kind: 'ORDER',
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    expect(off.json().code).toBe('ITEM_UNAVAILABLE');

    for (let i = 0; i < 5; i += 1) {
      expect(
        (await phone('POST', `/public/qr/${token}/requests`, { kind: 'WAITER' })).statusCode,
      ).toBe(201);
    }
    const sixth = await phone('POST', `/public/qr/${token}/requests`, { kind: 'BILL' });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().code).toBe('QR_TOO_MANY_REQUESTS');

    const [first] = QrRequestsResponseSchema.parse(
      (await admin('GET', '/qr-requests')).json(),
    ).data;
    expect((await kitchen('POST', `/qr-requests/${first!.id}/done`)).statusCode).toBe(403);
    // A new QR code for the table: the old one stops working.
    await admin(
      'POST',
      `/tables/${(await admin('GET', '/floor')).json().areas[0].tables[0].id}/qr`,
    );
    expect((await phone('GET', `/public/qr/${token}/menu`)).statusCode).toBe(404);
  });
});
