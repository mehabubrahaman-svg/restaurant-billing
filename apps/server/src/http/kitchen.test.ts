import {
  ChefsResponseSchema,
  FireKotsResponseSchema,
  KitchenMetricsSchema,
  KotSchema,
  KotsResponseSchema,
  OrderSchema,
  TokenBoardSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { caller, signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

async function kitchenSetup() {
  const r = await restaurantServer();
  s = r.s;
  const captain = await signInAs(r.s, r.admin, 'CAPTAIN', 'rahul');
  const chef = await signInAs(r.s, r.admin, 'KITCHEN', 'chef.bose');
  const order = await r.openAt(captain, r.tables.t1.id);
  await captain('POST', `/orders/${order.id}/items`, {
    items: [
      {
        menuItemId: r.menu.biryani.id,
        variantId: r.menu.full.id,
        quantity: 1,
        specialNote: 'Less spicy',
        addons: [{ addonId: r.menu.raita.id }],
      },
      { menuItemId: r.menu.naan.id, quantity: 2 },
    ],
  });
  const fired = FireKotsResponseSchema.parse(
    (await captain('POST', `/orders/${order.id}/kots`)).json(),
  );
  const [mainKot, tandoorKot] = fired.kots as [(typeof fired.kots)[0], (typeof fired.kots)[0]];
  return { ...r, captain, chef, order, mainKot, tandoorKot };
}

describe('kitchen display', () => {
  it('shows active KOTs with everything the cook needs, filterable by station', async () => {
    const { chef, menu, mainKot } = await kitchenSetup();
    const board = KotsResponseSchema.parse((await chef('GET', '/kitchen/kots')).json()).data;
    expect(board).toHaveLength(2);
    expect(board[0]).toMatchObject({
      kotNo: 1,
      orderNo: '1',
      orderType: 'DINE_IN',
      tableLabel: 'T1',
      captainName: 'rahul',
      stationName: 'Main Kitchen',
      status: 'NEW',
      targetReadyAt: '2026-10-28T12:20:00.000Z',
      items: [
        {
          name: 'Chicken Biryani',
          variantName: 'Full',
          quantity: 1,
          specialNote: 'Less spicy',
          addons: [{ name: 'Raita', quantity: 1 }],
          status: 'SENT',
        },
      ],
    });
    const tandoor = KotsResponseSchema.parse(
      (await chef('GET', `/kitchen/kots?station=${menu.tandoor.id}`)).json(),
    ).data;
    expect(tandoor.map((k) => k.stationName)).toEqual(['Tandoor']);
    void mainKot;
  });

  it('moves a KOT forward only, and the order items follow', async () => {
    const { chef, captain, order, mainKot, order: _o } = await kitchenSetup();
    const set = (to: string, version: number) =>
      chef('POST', `/kitchen/kots/${mainKot.id}/status`, { to, version });
    let kot = KotSchema.parse((await set('ACCEPTED', mainKot.version)).json());
    s!.clock.advance(60_000);
    kot = KotSchema.parse((await set('COOKING', kot.version)).json());
    expect(kot.items[0]!.status).toBe('PREPARING');
    expect((await set('ACCEPTED', kot.version)).json().code).toBe('INVALID_STATE_TRANSITION');
    expect((await set('READY', kot.version - 1)).json().code).toBe('VERSION_CONFLICT');
    s!.clock.advance(9 * 60_000);
    kot = KotSchema.parse((await set('READY', kot.version)).json());
    expect(kot).toMatchObject({ status: 'READY', readyAt: '2026-10-28T12:10:00.000Z' });

    const pad = OrderSchema.parse((await captain('GET', `/orders/${order.id}`)).json());
    expect(pad.readyCount).toBe(1);
    expect(pad.items[0]!.status).toBe('READY');

    // The captain may only mark it served.
    const tandoorKot = pad.kots.find((k) => k.kotNo === 2)!;
    expect(
      (
        await captain('POST', `/kitchen/kots/${tandoorKot.id}/status`, {
          to: 'READY',
          version: tandoorKot.version,
        })
      ).json().code,
    ).toBe('FORBIDDEN');
    const served = await captain('POST', `/kitchen/kots/${mainKot.id}/status`, {
      to: 'SERVED',
      version: kot.version,
    });
    expect(served.json()).toMatchObject({ status: 'SERVED', items: [{ status: 'SERVED' }] });
    const history = s!.database.db
      .prepare<[string], string>(
        "SELECT coalesce(from_status, '') || '>' || to_status FROM kot_status_events WHERE kot_id = ? ORDER BY occurred_at, rowid",
      )
      .pluck()
      .all(mainKot.id);
    expect(history).toEqual(
      ['null>NEW', 'NEW>ACCEPTED', 'ACCEPTED>COOKING', 'COOKING>READY', 'READY>SERVED'].map((h) =>
        h.replace('null>', '>'),
      ),
    );
  });

  it('bumps items one by one; the last one makes the KOT ready', async () => {
    const { chef, tandoorKot, order, captain } = await kitchenSetup();
    const kot = KotSchema.parse((await chef('GET', '/kitchen/kots')).json().data[1]);
    expect(kot.id).toBe(tandoorKot.id);
    const naan = kot.items[0]!;
    const bumped = KotSchema.parse(
      (await chef('POST', `/kitchen/kots/${kot.id}/items/${naan.id}/ready`)).json(),
    );
    expect(bumped).toMatchObject({ status: 'READY', items: [{ status: 'READY' }] });
    expect((await chef('POST', `/kitchen/kots/${kot.id}/items/${naan.id}/ready`)).json().code).toBe(
      'INVALID_STATE_TRANSITION',
    );
    const pad = OrderSchema.parse((await captain('GET', `/orders/${order.id}`)).json());
    expect(pad.readyCount).toBe(2);
  });

  it('assigns chefs who work the kitchen, and reports metrics', async () => {
    const { chef, admin, mainKot, tandoorKot } = await kitchenSetup();
    const chefs = ChefsResponseSchema.parse((await admin('GET', '/kitchen/chefs')).json()).data;
    expect(chefs.map((c) => c.fullName)).toEqual(['Ananya Sen', 'chef.bose']);
    const bose = chefs.find((c) => c.fullName === 'chef.bose')!;
    const rahul = (await admin('GET', '/users'))
      .json()
      .data.find((u: { username: string }) => u.username === 'rahul');
    expect(
      (
        await admin('POST', `/kitchen/kots/${mainKot.id}/assign`, {
          chefId: rahul.id,
          version: mainKot.version,
        })
      ).json().code,
    ).toBe('VALIDATION_FAILED');
    const assigned = KotSchema.parse(
      (
        await admin('POST', `/kitchen/kots/${mainKot.id}/assign`, {
          chefId: bose.id,
          version: mainKot.version,
        })
      ).json(),
    );
    expect(assigned.assignedChefName).toBe('chef.bose');
    expect(
      (
        await chef('POST', `/kitchen/kots/${mainKot.id}/assign`, {
          chefId: null,
          version: assigned.version,
        })
      ).statusCode,
    ).toBe(403);

    s!.clock.advance(8 * 60_000);
    await chef('POST', `/kitchen/kots/${tandoorKot.id}/status`, {
      to: 'READY',
      version: tandoorKot.version,
    });
    s!.clock.advance(20 * 60_000); // main kitchen's 20-minute target has passed (and the 15-minute access token)
    const later = caller(s!, (await s!.login('chef.bose', 'Staff#Pass2026')).accessToken);
    const metrics = KitchenMetricsSchema.parse((await later('GET', '/kitchen/metrics')).json());
    expect(metrics).toMatchObject({
      businessDate: '2026-10-28',
      pending: 1,
      delayed: 1,
      completed: 1,
      avgCookSeconds: 480,
    });
    expect(metrics.perChef).toEqual([
      { chefId: bose.id, fullName: 'chef.bose', completed: 0, avgCookSeconds: null },
    ]);
    expect(
      (
        await caller(s!, (await s!.login('rahul', 'Staff#Pass2026')).accessToken)(
          'GET',
          '/kitchen/kots',
        )
      ).statusCode,
    ).toBe(403);
  });

  it('feeds the token display for takeaway orders', async () => {
    const { captain, chef, menu, ok } = await kitchenSetup();
    const takeaway = await ok(captain('POST', '/orders', { orderType: 'TAKEAWAY' }), OrderSchema);
    await captain('POST', `/orders/${takeaway.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    const board = async () =>
      TokenBoardSchema.parse((await s!.app.inject({ url: '/api/v1/tokens' })).json());
    expect(await board()).toMatchObject({ preparing: [], ready: [] });
    const fired = FireKotsResponseSchema.parse(
      (await captain('POST', `/orders/${takeaway.id}/kots`)).json(),
    );
    expect(await board()).toMatchObject({ preparing: [1], ready: [] });
    await chef('POST', `/kitchen/kots/${fired.kots[0]!.id}/status`, {
      to: 'READY',
      version: fired.kots[0]!.version,
    });
    expect(await board()).toMatchObject({ preparing: [], ready: [1] });
  });
});
