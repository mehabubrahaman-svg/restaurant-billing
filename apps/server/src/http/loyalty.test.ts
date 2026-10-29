import { BillResponseSchema, LoyaltyLedgerSchema } from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs } from '../testing/staff';
import { ADMIN, type TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

describe('loyalty points', () => {
  it('earns on paid bills, spends as a tender, gives back on cancel, and adjusts', async () => {
    const r = await restaurantServer();
    s = r.s;
    const captain = await signInAs(r.s, r.admin, 'CAPTAIN', 'rahul');
    const cashier = await signInAs(r.s, r.admin, 'CASHIER', 'meera');
    await cashier('POST', '/cash-shifts', { openingFloat: 0 });

    // Off by default: no points on a paid bill.
    const settings = (await r.admin('GET', '/settings/branch')).json();
    expect(settings).toMatchObject({ loyaltyEnabled: false, loyaltyPointValue: 100 });

    const bill = async (tableId: string, phone?: string) => {
      const order = await r.openAt(captain, tableId);
      await captain('POST', `/orders/${order.id}/items`, {
        items: [{ menuItemId: r.menu.naan.id, quantity: 20 }],
      });
      await captain('POST', `/orders/${order.id}/kots`);
      return BillResponseSchema.parse(
        (
          await cashier('POST', `/orders/${order.id}/invoice`, {
            ...(phone === undefined ? {} : { customer: { phone, name: 'Sourav' } }),
          })
        ).json(),
      ).invoices[0]!;
    };

    const first = await bill(r.tables.t1.id, '98300 12345');
    await cashier('POST', `/invoices/${first.id}/payments`, {
      payments: [{ method: 'CASH', amount: first.grandTotal }],
    });
    const customerId = first.customerId!;
    const ledger = async () =>
      LoyaltyLedgerSchema.parse((await cashier('GET', `/customers/${customerId}/loyalty`)).json());
    expect((await ledger()).balance).toBe(0);

    // The owner turns points on: 5 per ₹100, ₹1 each, at least 10 at a time.
    const on = await r.admin('PATCH', '/settings/branch', {
      version: settings.version,
      loyaltyEnabled: true,
      loyaltyEarnPer100: 5,
      loyaltyPointValue: 100,
      loyaltyMinRedeem: 10,
    });
    expect(on.json()).toMatchObject({ loyaltyEnabled: true, loyaltyEarnPer100: 5 });

    // A manager adds a birthday gift; a cashier may not.
    expect(
      (
        await cashier('POST', `/customers/${customerId}/loyalty`, {
          points: 100,
          note: 'Birthday gift',
        })
      ).statusCode,
    ).toBe(403);
    const gift = LoyaltyLedgerSchema.parse(
      (
        await r.admin('POST', `/customers/${customerId}/loyalty`, {
          points: 100,
          note: 'Birthday gift',
        })
      ).json(),
    );
    expect(gift.balance).toBe(100);
    expect(gift.entries[0]).toMatchObject({ kind: 'ADJUST', points: 100, note: 'Birthday gift' });
    const tooMuch = await r.admin('POST', `/customers/${customerId}/loyalty`, {
      points: -500,
      note: 'Wrong guest',
    });
    expect(tooMuch.json().code).toBe('LOYALTY_INSUFFICIENT');

    // Second visit: ₹60 in points, the rest in cash. Points come only on the cash part.
    const second = await bill(r.tables.t2.id, '9830012345');
    const cash = second.grandTotal - 60_00;
    const paid = await cashier('POST', `/invoices/${second.id}/payments`, {
      payments: [
        { method: 'LOYALTY', amount: 60_00 },
        { method: 'CASH', amount: cash },
      ],
    });
    expect(paid.statusCode).toBe(200);
    const earned = Math.floor(cash / 100_00) * 5;
    const afterPay = await ledger();
    expect(afterPay.balance).toBe(100 - 60 + earned);
    expect(afterPay.entries.slice(0, 2).map((e) => [e.kind, e.points, e.invoiceNo])).toEqual([
      ['EARN', earned, second.invoiceNo],
      ['REDEEM', -60, second.invoiceNo],
    ]);

    // Cancelling the bill in the same shift (a manager approves) gives the 60 points back
    // and takes the earned ones away.
    const invoice = (await cashier('GET', `/invoices/${second.id}`)).json();
    const owner = (await cashier('GET', '/auth/pin-users'))
      .json()
      .data.find((u: { fullName: string }) => u.fullName === 'Ananya Sen');
    const approval = await cashier('POST', '/auth/approve', {
      userId: owner.id,
      pin: ADMIN.pin,
      permission: 'billing.cancel',
    });
    const cancelled = await cashier(
      'POST',
      `/invoices/${second.id}/cancel`,
      { version: invoice.version, reason: 'Wrong table billed' },
      { 'x-approver-token': approval.json().approverToken as string },
    );
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
    expect((await ledger()).balance).toBe(100);

    // Points need the guest on the bill, whole points, and enough of them.
    const third = await bill(r.tables.t3.id);
    const noGuest = await cashier('POST', `/invoices/${third.id}/payments`, {
      payments: [{ method: 'LOYALTY', amount: 20_00 }],
    });
    expect(noGuest.json().code).toBe('VALIDATION_FAILED');
    // The cancelled bill's order is open again: bill it once more.
    const again = BillResponseSchema.parse(
      (
        await cashier('POST', `/orders/${second.orderId}/invoice`, {
          customer: { phone: '9830012345' },
        })
      ).json(),
    ).invoices[0]!;
    const over = await cashier('POST', `/invoices/${again.id}/payments`, {
      payments: [{ method: 'LOYALTY', amount: 150_00 }],
    });
    expect(over.json().code).toBe('LOYALTY_INSUFFICIENT');
    const part = await cashier('POST', `/invoices/${again.id}/payments`, {
      payments: [{ method: 'LOYALTY', amount: 20_50 }],
    });
    expect(part.json().code).toBe('VALIDATION_FAILED');
    expect((await ledger()).balance).toBe(100);

    // The customer record carries the balance.
    expect((await cashier('GET', `/customers/${customerId}`)).json().loyaltyPoints).toBe(100);
  });
});
