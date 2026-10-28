import {
  FireKotsResponseSchema,
  FloorResponseSchema,
  OrderSchema,
  OrdersResponseSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { caller, signInAs, trail } from '../testing/staff';
import { ADMIN, type TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

async function setup() {
  const r = await restaurantServer();
  s = r.s;
  const captain = await signInAs(r.s, r.admin, 'CAPTAIN', 'rahul');
  return { ...r, captain };
}

describe('orders', () => {
  it('opens a table, prices items from the menu, and shows it on the floor', async () => {
    const { captain, tables, menu, openAt, ok, s } = await setup();
    const order = await openAt(captain, tables.t1.id, 4);
    expect(order).toMatchObject({
      orderNo: '1',
      orderType: 'DINE_IN',
      tableLabel: 'T1',
      covers: 4,
      status: 'OPEN',
      tokenNo: null,
    });
    expect(order.captainName).toBe('rahul');

    const added = await ok(
      captain('POST', `/orders/${order.id}/items`, {
        items: [
          {
            menuItemId: menu.biryani.id,
            variantId: menu.full.id,
            quantity: 2,
            addons: [{ addonId: menu.raita.id }],
            specialNote: 'Less spicy',
          },
          { menuItemId: menu.naan.id, quantity: 4 },
        ],
      }),
      OrderSchema,
    );
    expect(
      added.items.map((i) => [
        i.name,
        i.variantName,
        i.unitPrice,
        i.addonsTotal,
        i.quantity,
        i.lineTotal,
        i.status,
      ]),
    ).toEqual([
      ['Chicken Biryani', 'Full', 32000, 4000, 2, 72000, 'PENDING'],
      ['Butter Naan', null, 6000, 0, 4, 24000, 'PENDING'],
    ]);
    expect(added).toMatchObject({ subtotal: 96000, itemCount: 6, pendingCount: 6 });

    const floor = FloorResponseSchema.parse((await captain('GET', '/floor')).json());
    const t1 = floor.areas[0]!.tables.find((t) => t.label === 'T1')!;
    expect(t1).toMatchObject({
      status: 'OCCUPIED',
      currentOrderId: order.id,
      openOrder: { id: order.id, subtotal: 96000, covers: 4, pendingCount: 6 },
    });
    expect(floor.areas[0]!.tables.find((t) => t.label === 'T2')!.openOrder).toBeNull();
    expect(trail(s, order.id).audit).toEqual(['order.open', 'order.items.add']);

    // A second order at the same table is refused.
    expect(
      (await captain('POST', '/orders', { orderType: 'DINE_IN', tableId: tables.t1.id })).json()
        .code,
    ).toBe('TABLE_NOT_FREE');
  });

  it('numbers takeaway orders and tokens per business day', async () => {
    const { captain, ok } = await setup();
    const a = await ok(captain('POST', '/orders', { orderType: 'TAKEAWAY' }), OrderSchema);
    const b = await ok(
      captain('POST', '/orders', { orderType: 'DELIVERY', notes: 'Flat 4B' }),
      OrderSchema,
    );
    expect([a.orderNo, a.tokenNo, b.orderNo, b.tokenNo]).toEqual(['1', 1, '2', 2]);
    s!.clock.advance(24 * 3600_000);
    const nextDay = caller(s!, (await s!.login('rahul', 'Staff#Pass2026')).accessToken);
    const c = await ok(nextDay('POST', '/orders', { orderType: 'TAKEAWAY' }), OrderSchema);
    expect([c.orderNo, c.tokenNo, c.businessDate]).toEqual(['1', 1, '2026-10-29']);
    expect(OrdersResponseSchema.parse((await nextDay('GET', '/orders')).json()).data).toHaveLength(
      3,
    );
  });

  it('checks sizes, add-on limits and availability', async () => {
    const { captain, admin, tables, menu, openAt } = await setup();
    const order = await openAt(captain, tables.t1.id);
    const add = (item: object) => captain('POST', `/orders/${order.id}/items`, { items: [item] });
    expect((await add({ menuItemId: menu.biryani.id, quantity: 1 })).json().code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await add({ menuItemId: menu.naan.id, variantId: menu.full.id, quantity: 1 })).json().code,
    ).toBe('VALIDATION_FAILED');
    const three = menu.sides.addons.map((a) => ({ addonId: a.id }));
    expect(
      (await add({ menuItemId: menu.naan.id, quantity: 1, addons: three.slice(0, 1) })).json().code,
    ).toBe('VALIDATION_FAILED');
    await admin('POST', `/menu-items/${menu.naan.id}/availability`, { isAvailable: false });
    expect((await add({ menuItemId: menu.naan.id, quantity: 1 })).json().code).toBe(
      'ITEM_UNAVAILABLE',
    );
  });

  it('fires one KOT per station and only pending items', async () => {
    const { captain, tables, menu, openAt, ok, s } = await setup();
    const order = await openAt(captain, tables.t1.id);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [
        { menuItemId: menu.biryani.id, variantId: menu.half.id, quantity: 1 },
        { menuItemId: menu.naan.id, quantity: 2 },
      ],
    });
    const fired = FireKotsResponseSchema.parse(
      (await captain('POST', `/orders/${order.id}/kots`)).json(),
    );
    expect(fired.kots.map((k) => [k.kotNo, k.stationName, k.status])).toEqual([
      [1, 'Main Kitchen', 'NEW'],
      [2, 'Tandoor', 'NEW'],
    ]);
    expect(fired.order.items.every((i) => i.status === 'SENT' && i.kotId)).toBe(true);
    expect(fired.order.pendingCount).toBe(0);
    expect((await captain('POST', `/orders/${order.id}/kots`)).json().code).toBe('NOTHING_TO_FIRE');

    await captain('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    const second = FireKotsResponseSchema.parse(
      (await captain('POST', `/orders/${order.id}/kots`)).json(),
    );
    expect(second.kots.map((k) => k.kotNo)).toEqual([3]);
    expect(second.order.kots).toHaveLength(3);
    expect(trail(s, fired.kots[0]!.id).events).toEqual(['KotFired']);
    const statusRows = s.database.db
      .prepare('SELECT count(*) FROM kot_status_events')
      .pluck()
      .get();
    expect(statusRows).toBe(3);
    // Idempotent retry of the fire (lost Wi-Fi) returns the stored response.
    const key = { 'idempotency-key': 'fire-retry-0001' };
    await captain('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    const firstTry = await captain('POST', `/orders/${order.id}/kots`, undefined, key);
    const retry = await captain('POST', `/orders/${order.id}/kots`, undefined, key);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(firstTry.json());
    void ok;
  });

  it('edits pending items, and needs a manager to cancel what the kitchen has', async () => {
    const { captain, admin, tables, menu, openAt, ok, s } = await setup();
    const order = await openAt(captain, tables.t1.id);
    let current = await ok(
      captain('POST', `/orders/${order.id}/items`, {
        items: [
          { menuItemId: menu.naan.id, quantity: 2 },
          { menuItemId: menu.biryani.id, variantId: menu.full.id, quantity: 1 },
        ],
      }),
      OrderSchema,
    );
    const [naan, biryani] = current.items as [(typeof current.items)[0], (typeof current.items)[0]];
    current = await ok(
      captain('PATCH', `/orders/${order.id}/items/${naan.id}`, {
        version: naan.version,
        quantity: 3,
        specialNote: 'Extra butter',
      }),
      OrderSchema,
    );
    expect(current.items[0]).toMatchObject({
      quantity: 3,
      specialNote: 'Extra butter',
      version: 2,
    });

    // Pending: the captain can just remove it.
    current = await ok(
      captain('POST', `/orders/${order.id}/items/${biryani.id}/cancel`, {
        version: biryani.version,
      }),
      OrderSchema,
    );
    expect(current.items[1]!.status).toBe('CANCELLED');
    expect(current.subtotal).toBe(18000);

    await captain('POST', `/orders/${order.id}/kots`);
    expect(
      (
        await captain('PATCH', `/orders/${order.id}/items/${naan.id}`, { version: 2, quantity: 1 })
      ).json().code,
    ).toBe('ITEM_ALREADY_SENT');

    const denied = await captain('POST', `/orders/${order.id}/items/${naan.id}/cancel`, {
      version: 2,
      reason: 'Burnt',
      isWastage: true,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      code: 'APPROVAL_REQUIRED',
      permission: 'orders.item_cancel',
    });

    // A manager approves with their PIN on the captain's tablet.
    const owner = (await captain('GET', '/auth/pin-users')).json().data[0];
    const approval = await captain('POST', '/auth/approve', {
      userId: owner.id,
      pin: ADMIN.pin,
      permission: 'orders.item_cancel',
    });
    expect(approval.statusCode).toBe(200);
    const approved = await captain(
      'POST',
      `/orders/${order.id}/items/${naan.id}/cancel`,
      { version: 2, reason: 'Burnt', isWastage: true },
      { 'x-approver-token': approval.json().approverToken },
    );
    expect(approved.statusCode).toBe(200);
    const after = OrderSchema.parse(approved.json());
    expect(after.items[0]).toMatchObject({ status: 'CANCELLED', cancelReason: 'Burnt' });
    expect(after.kots[0]!.status).toBe('CANCELLED');
    const audit = s.database.db
      .prepare<[], { approver_id: string | null; reason: string }>(
        "SELECT approver_id, reason FROM audit_logs WHERE action = 'order.item.void'",
      )
      .get();
    expect(audit).toEqual({ approver_id: owner.id, reason: 'Burnt' });
    void admin;
  });

  it('cancels an order: freely before anything is sent, with approval after', async () => {
    const { captain, admin, tables, menu, openAt, ok } = await setup();
    const empty = await openAt(captain, tables.t1.id);
    const cancelled = await ok(
      captain('POST', `/orders/${empty.id}/cancel`, {
        version: empty.version,
        reason: 'Opened by mistake',
      }),
      OrderSchema,
    );
    expect(cancelled.status).toBe('CANCELLED');
    const floor = FloorResponseSchema.parse((await captain('GET', '/floor')).json());
    expect(floor.areas[0]!.tables.find((t) => t.label === 'T1')).toMatchObject({
      status: 'AVAILABLE',
      currentOrderId: null,
      openOrder: null,
    });

    const order = await openAt(captain, tables.t1.id);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    await captain('POST', `/orders/${order.id}/kots`);
    const current = await ok(captain('GET', `/orders/${order.id}`), OrderSchema);
    expect(
      (
        await captain('POST', `/orders/${order.id}/cancel`, {
          version: current.version,
          reason: 'Guests left',
        })
      ).json().code,
    ).toBe('APPROVAL_REQUIRED');
    const byManager = await ok(
      admin('POST', `/orders/${order.id}/cancel`, {
        version: current.version,
        reason: 'Guests left',
      }),
      OrderSchema,
    );
    expect(byManager.status).toBe('CANCELLED');
    expect(byManager.kots.every((k) => k.status === 'CANCELLED')).toBe(true);
    expect(
      (
        await captain('POST', `/orders/${order.id}/items`, {
          items: [{ menuItemId: menu.naan.id, quantity: 1 }],
        })
      ).json().code,
    ).toBe('ORDER_NOT_OPEN');
  });

  it('moves an order to a free table and merges two tables', async () => {
    const { captain, tables, menu, openAt, ok, order: get } = await setup();
    const a = await openAt(captain, tables.t1.id, 2);
    await captain('POST', `/orders/${a.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 2 }],
    });
    await captain('POST', `/orders/${a.id}/kots`);

    const moved = await ok(
      captain('POST', `/tables/${tables.t1.id}/transfer`, {
        targetTableId: tables.t2.id,
        mode: 'MOVE',
      }),
      OrderSchema,
    );
    expect(moved).toMatchObject({ id: a.id, tableLabel: 'T2' });

    const b = await openAt(captain, tables.t3.id, 3);
    await captain('POST', `/orders/${b.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    expect(
      (
        await captain('POST', `/tables/${tables.t3.id}/transfer`, {
          targetTableId: tables.t2.id,
          mode: 'MOVE',
        })
      ).json().code,
    ).toBe('TABLE_NOT_FREE');

    const merged = await ok(
      captain('POST', `/tables/${tables.t3.id}/transfer`, {
        targetTableId: tables.t2.id,
        mode: 'MERGE',
      }),
      OrderSchema,
    );
    expect(merged).toMatchObject({
      id: a.id,
      covers: 5,
      itemCount: 3,
      subtotal: 18000,
      pendingCount: 1,
    });
    expect(merged.kots).toHaveLength(1);
    expect((await get(captain, b.id)).status).toBe('CANCELLED');

    const floor = FloorResponseSchema.parse((await captain('GET', '/floor')).json());
    const status = Object.fromEntries(floor.areas[0]!.tables.map((t) => [t.label, t.status]));
    expect(status).toEqual({ T1: 'AVAILABLE', T2: 'OCCUPIED', T3: 'AVAILABLE' });
  });

  it('keeps kitchen staff out of the order pad', async () => {
    const { admin, tables, s } = await setup();
    const kitchen = await signInAs(s, admin, 'KITCHEN', 'chef.bose');
    expect(
      (await kitchen('POST', '/orders', { orderType: 'DINE_IN', tableId: tables.t1.id }))
        .statusCode,
    ).toBe(403);
  });
});
