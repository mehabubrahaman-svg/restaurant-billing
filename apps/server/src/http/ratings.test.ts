import {
  BestsellersResponseSchema,
  OrderRatingsResponseSchema,
  OrderSchema,
  QrMenuSchema,
  RatingLookupResponseSchema,
  RatingSummarySchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { caller, signInAs, trail } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

const PHONE = '98765 43210';
const DAY = 24 * 60 * 60_000;

/** A captain's table with naan (twice) and a biryani sent to the kitchen, and the table's QR code. */
async function servedTable() {
  const r = await restaurantServer();
  s = r.s;
  const captain = await signInAs(r.s, r.admin, 'CAPTAIN', 'rahul');
  const { url } = (await r.admin('POST', `/tables/${r.tables.t1.id}/qr`)).json();
  const token = String(url).split('/qr/')[1]!;
  const phone = (method: 'GET' | 'POST', path: string, payload?: object) =>
    r.s.app.inject({ method, url: `/api/v1${path}`, ...(payload ? { payload } : {}) });
  const opened = await r.openAt(captain, r.tables.t1.id);
  await captain('POST', `/orders/${opened.id}/items`, {
    items: [
      { menuItemId: r.menu.naan.id, quantity: 2 },
      { menuItemId: r.menu.biryani.id, variantId: r.menu.full.id, quantity: 1 },
    ],
  });
  await captain('POST', `/orders/${opened.id}/items`, {
    items: [{ menuItemId: r.menu.naan.id, quantity: 1 }],
  });
  await captain('POST', `/orders/${opened.id}/kots`);
  const setGuest = async (number: string | null, name?: string) => {
    const { version } = await r.order(captain, opened.id);
    return captain('POST', `/orders/${opened.id}/guest`, { version, phone: number, name });
  };
  return { ...r, captain, token, phone, orderId: opened.id, setGuest };
}

describe('guest ratings', () => {
  it('puts the guest’s phone on the order, and the bill picks the guest up', async () => {
    const { admin, captain, orderId, setGuest } = await servedTable();
    const cashier = await signInAs(s!, admin, 'CASHIER', 'meera');

    const set = await setGuest(PHONE, 'Ananya');
    expect(set.statusCode).toBe(200);
    // Every screen with the order sees the name and the last four digits only.
    expect(OrderSchema.parse(set.json()).guest).toEqual({ name: 'Ananya', phoneLast4: '3210' });
    expect(
      (await captain('POST', `/orders/${orderId}/guest`, { version: 1, phone: PHONE })).json().code,
    ).toBe('VERSION_CONFLICT');
    expect(trail(s!, orderId).audit).toContain('order.guest.set');
    const audit = s!.database.db
      .prepare<[string], string>(
        "SELECT after_json FROM audit_logs WHERE entity_id = ? AND action = 'order.guest.set'",
      )
      .pluck()
      .get(orderId)!;
    expect(audit).not.toContain('9876543210');

    // The bill, with no phone given at the counter, is the guest's.
    const billed = (await cashier('POST', `/orders/${orderId}/invoice`, {})).json();
    expect(billed.invoices[0]).toMatchObject({ customerName: 'Ananya' });
    expect(billed.invoices[0].customerId).toEqual(expect.any(String));
    const found = (await admin('GET', '/customers?q=3210')).json().data;
    expect(found.map((c: { phone: string }) => c.phone)).toEqual(['+919876543210']);
  });

  it('lets the guest find today’s order by phone and rate the captain and each dish, once', async () => {
    const { menu, token, phone, orderId, setGuest } = await servedTable();
    await setGuest(PHONE);
    const lookup = async (number: string) =>
      RatingLookupResponseSchema.parse(
        (await phone('POST', `/public/qr/${token}/ratings/lookup`, { phone: number })).json(),
      ).orders;

    const [order] = await lookup('+91 98765-43210');
    expect(order).toMatchObject({
      id: orderId,
      tableLabel: 'T1',
      captainName: 'rahul',
      rated: false,
    });
    // Each dish once, as it was first ordered.
    expect(order!.dishes.map((d) => d.menuItemId)).toEqual([menu.naan.id, menu.biryani.id]);
    expect(await lookup('9123456789')).toEqual([]);
    expect(
      (await phone('POST', `/public/qr/${token}/ratings/lookup`, { phone: '12345' })).statusCode,
    ).toBe(422);

    const rate = (body: object) => phone('POST', `/public/qr/${token}/ratings`, body);
    const rating = {
      orderId,
      phone: PHONE,
      captainStars: 5,
      comment: 'Lovely evening',
      dishes: [
        { menuItemId: menu.naan.id, stars: 4 },
        { menuItemId: menu.biryani.id, stars: 2, comment: 'A little salty' },
      ],
    };
    expect(
      (await rate({ ...rating, dishes: [{ menuItemId: menu.raita.id, stars: 5 }] })).json().code,
    ).toBe('VALIDATION_FAILED');
    expect((await rate({ ...rating, phone: '9123456789' })).json().code).toBe('NOT_FOUND');
    expect((await rate({ orderId, phone: PHONE, dishes: [] })).statusCode).toBe(422);
    const saved = await rate(rating);
    expect(saved.statusCode).toBe(201);
    expect((await rate(rating)).json().code).toBe('ALREADY_RATED');
    expect((await lookup(PHONE))[0]!.rated).toBe(true);
    expect(trail(s!, saved.json().id).events).toEqual(['OrderRated']);

    // "For the day": tomorrow the order is no longer found.
    s!.clock.advance(DAY);
    expect(await lookup(PHONE)).toEqual([]);
  });

  it('lets an admin count dish ratings toward the menu, see captains, and publish bestsellers', async () => {
    const { admin, captain, menu, token, phone, orderId, setGuest, order } = await servedTable();
    await setGuest(PHONE, 'Ananya');
    await phone('POST', `/public/qr/${token}/ratings`, {
      orderId,
      phone: PHONE,
      captainStars: 5,
      dishes: [
        { menuItemId: menu.naan.id, stars: 4 },
        { menuItemId: menu.biryani.id, stars: 2, comment: 'A little salty' },
      ],
    });
    const { businessDate: day } = await order(captain, orderId);
    const list = async (status = 'ALL') =>
      OrderRatingsResponseSchema.parse(
        (await admin('GET', `/ratings?from=${day}&to=${day}&status=${status}`)).json(),
      ).data;
    const menuNow = async () =>
      QrMenuSchema.parse((await phone('GET', `/public/qr/${token}/menu`)).json());

    const [rating] = await list('PENDING');
    expect(rating).toMatchObject({
      orderId,
      tableLabel: 'T1',
      guestName: 'Ananya',
      guestPhoneLast4: '3210',
      captainName: 'rahul',
      captainStars: 5,
    });
    expect(rating!.dishes.map((d) => [d.name, d.stars, d.status])).toEqual([
      ['Butter Naan', 4, 'PENDING'],
      ['Chicken Biryani', 2, 'PENDING'],
    ]);
    // Captains don't read their own ratings.
    expect((await captain('GET', `/ratings?from=${day}&to=${day}`)).statusCode).toBe(403);
    // Nothing shows on the menu until an admin counts it.
    expect((await menuNow()).ratings).toEqual([]);

    const [naan, biryani] = rating!.dishes;
    const review = async (ids: string[], status: string) =>
      (await admin('POST', '/ratings/dishes/review', { ids, status })).json().updated;
    expect(await review([naan!.id], 'COUNTED')).toBe(1);
    expect(await review([biryani!.id], 'EXCLUDED')).toBe(1);
    expect(await review([naan!.id], 'COUNTED')).toBe(0);
    expect(trail(s!, naan!.id).audit).toEqual(['crm.dish_rating.review']);
    expect(await list('PENDING')).toEqual([]);
    expect((await menuNow()).ratings).toEqual([{ menuItemId: menu.naan.id, average: 4, count: 1 }]);

    const summary = RatingSummarySchema.parse(
      (await admin('GET', `/ratings/summary?from=${day}&to=${day}`)).json(),
    );
    expect(summary.captains).toEqual([
      expect.objectContaining({ name: 'rahul', ratings: 1, average: 5 }),
    ]);
    expect(summary.dishes).toEqual([
      expect.objectContaining({ name: 'Butter Naan', counted: 1, average: 4, pending: 0 }),
      expect.objectContaining({ name: 'Chicken Biryani', counted: 0, average: null, excluded: 1 }),
    ]);

    // Bestsellers: suggested by what was ordered, published by the admin.
    const before = BestsellersResponseSchema.parse((await admin('GET', '/bestsellers')).json());
    expect(before.items).toEqual([]);
    expect(before.suggestions.map((d) => [d.name, d.rank, d.average])).toEqual([
      ['Butter Naan', 1, 4],
      ['Chicken Biryani', 2, null],
    ]);
    expect((await menuNow()).popularItemIds).toEqual([]);
    const saved = BestsellersResponseSchema.parse(
      (
        await admin('PUT', '/bestsellers', {
          items: [
            { menuItemId: menu.biryani.id, published: false },
            { menuItemId: menu.naan.id, published: true },
          ],
        })
      ).json(),
    );
    expect(saved.items.map((d) => [d.name, d.published])).toEqual([
      ['Chicken Biryani', false],
      ['Butter Naan', true],
    ]);
    expect(saved.suggestions).toEqual([]);
    expect((await menuNow()).popularItemIds).toEqual([menu.naan.id]);
    expect(
      (
        await admin('PUT', '/bestsellers', {
          items: [
            { menuItemId: menu.naan.id, published: true },
            { menuItemId: menu.naan.id, published: false },
          ],
        })
      ).statusCode,
    ).toBe(422);
    expect(
      trail(s!, s!.database.db.prepare('SELECT id FROM branches').pluck().get() as string).audit,
    ).toContain('crm.bestsellers.update');

    // A month on, nothing is suggested any more: the list stays as the admin left it.
    s!.clock.advance(31 * DAY);
    const fresh = caller(s!, (await s!.login()).accessToken);
    const later = BestsellersResponseSchema.parse((await fresh('GET', '/bestsellers')).json());
    expect(later.suggestions).toEqual([]);
    expect(later.items).toHaveLength(2);
  });
});
