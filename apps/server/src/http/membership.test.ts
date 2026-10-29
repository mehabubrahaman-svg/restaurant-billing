import {
  BillResponseSchema,
  CustomerDetailSchema,
  LoyaltyLedgerSchema,
  MembershipTierSchema,
  MembershipTiersResponseSchema,
  OrderSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

const PHONE = '9830012345';

describe('membership tiers', () => {
  it('moves a guest up by spend and visits, discounts their bills and multiplies their points', async () => {
    const r = await restaurantServer();
    s = r.s;
    const { admin, menu, ok } = r;
    const cashier = await signInAs(r.s, admin, 'CASHIER', 'meera');
    await admin('POST', '/cash-shifts', { openingFloat: 0 });
    const settings = (await admin('GET', '/settings/branch')).json();
    await admin('PATCH', '/settings/branch', {
      version: settings.version,
      loyaltyEnabled: true,
      loyaltyEarnPer100: 5,
      loyaltyPointValue: 100,
      loyaltyMinRedeem: 10,
    });

    // Silver from ₹1,000: points ×1.5. Gold from ₹2,000 and 2 visits: points ×2 and 10% off.
    const silver = await ok(
      admin('POST', '/membership-tiers', {
        name: 'Silver',
        minSpend: 1_000_00,
        minVisits: 0,
        pointsMultiplierBp: 15_000,
      }),
      MembershipTierSchema,
    );
    const gold = await ok(
      admin('POST', '/membership-tiers', {
        name: 'Gold',
        minSpend: 2_000_00,
        minVisits: 2,
        pointsMultiplierBp: 20_000,
        discountBp: 1000,
      }),
      MembershipTierSchema,
    );
    expect(silver).toMatchObject({ discountBp: 0, isActive: true, version: 1 });
    expect(
      (await admin('POST', '/membership-tiers', { name: 'gold', minSpend: 0, minVisits: 0 })).json()
        .code,
    ).toBe('DUPLICATE_NAME');
    expect(
      (await cashier('POST', '/membership-tiers', { name: 'Bronze', minSpend: 0, minVisits: 0 }))
        .statusCode,
    ).toBe(403);
    // The counter reads tiers (to show a guest's), lowest first.
    expect(
      MembershipTiersResponseSchema.parse(
        (await cashier('GET', '/membership-tiers')).json(),
      ).data.map((t) => t.name),
    ).toEqual(['Silver', 'Gold']);

    /** A takeaway of 20 naan billed to the guest and paid in cash. */
    const visit = async () => {
      const order = await ok(admin('POST', '/orders', { orderType: 'TAKEAWAY' }), OrderSchema);
      await admin('POST', `/orders/${order.id}/items`, {
        items: [{ menuItemId: menu.naan.id, quantity: 20 }],
      });
      await admin('POST', `/orders/${order.id}/kots`);
      const [invoice] = BillResponseSchema.parse(
        (await admin('POST', `/orders/${order.id}/invoice`, { customer: { phone: PHONE } })).json(),
      ).invoices;
      await admin('POST', `/invoices/${invoice!.id}/payments`, {
        payments: [{ method: 'CASH', amount: invoice!.grandTotal }],
      });
      return invoice!;
    };
    const guest = async (id: string) =>
      CustomerDetailSchema.parse((await admin('GET', `/customers/${id}`)).json());
    const balance = async (id: string) =>
      LoyaltyLedgerSchema.parse((await admin('GET', `/customers/${id}/loyalty`)).json()).balance;
    const points = (paid: number) => Math.floor(paid / 100_00) * 5;

    // First visit: no tier yet, so no discount. The bill that reaches Silver earns at its rate.
    const first = await visit();
    expect(first.discounts).toEqual([]);
    const id = first.customerId!;
    let g = await guest(id);
    expect(g.tier).toEqual({
      id: silver.id,
      name: 'Silver',
      discountBp: 0,
      pointsMultiplierBp: 15_000,
      pinned: false,
    });
    expect(g.nextTier).toEqual({
      name: 'Gold',
      spendNeeded: 2_000_00 - first.grandTotal,
      visitsNeeded: 1,
    });
    const afterFirst = Math.floor((points(first.grandTotal) * 3) / 2);
    expect(await balance(id)).toBe(afterFirst);

    // Second visit reaches Gold: points ×2.
    const second = await visit();
    expect(second.discounts).toEqual([]);
    g = await guest(id);
    expect(g.tier).toMatchObject({ name: 'Gold', discountBp: 1000 });
    expect(g.nextTier).toBeNull();
    expect(await balance(id)).toBe(afterFirst + points(second.grandTotal) * 2);

    // As Gold, 10% comes off by itself, named for the tier.
    const third = await visit();
    expect(third.discounts).toEqual([
      expect.objectContaining({ kind: 'LOYALTY', value: 1000, reason: 'Gold' }),
    ]);
    expect(third.discounts[0]!.amount).toBe(Math.round(third.subtotal / 10));

    // A manager pins Silver: it holds whatever the guest has spent, and Gold's discount stops.
    // Counter staff may edit guests but not give them a tier.
    expect(
      (
        await cashier('PATCH', `/customers/${id}`, {
          membershipTierId: gold.id,
          version: g.version,
        })
      ).statusCode,
    ).toBe(403);
    const pinned = await admin('PATCH', `/customers/${id}`, {
      membershipTierId: silver.id,
      version: g.version,
    });
    expect(pinned.json().tier).toMatchObject({ name: 'Silver', pinned: true });
    expect((await visit()).discounts).toEqual([]);
    g = await guest(id);
    expect(g.nextTier).toBeNull();
    expect(
      (
        await admin('PATCH', `/customers/${id}`, {
          membershipTierId: '00000000-0000-4000-8000-000000000000',
          version: g.version,
        })
      ).json().code,
    ).toBe('VALIDATION_FAILED');
    const unpinned = await admin('PATCH', `/customers/${id}`, {
      membershipTierId: null,
      version: g.version,
    });
    expect(unpinned.json().tier).toMatchObject({ name: 'Gold', pinned: false });

    // Gold switched off: the guest is Silver again.
    await admin('PATCH', `/membership-tiers/${gold.id}`, {
      isActive: false,
      version: gold.version,
    });
    expect((await guest(id)).tier).toMatchObject({ name: 'Silver', pinned: false });
  });
});
