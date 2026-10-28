import {
  BillResponseSchema,
  CustomerDetailSchema,
  CustomersResponseSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

describe('customers', () => {
  it('adds the guest by mobile at billing and counts the visit and spend once paid', async () => {
    const r = await restaurantServer();
    s = r.s;
    const captain = await signInAs(r.s, r.admin, 'CAPTAIN', 'rahul');
    const cashier = await signInAs(r.s, r.admin, 'CASHIER', 'meera');
    await cashier('POST', '/cash-shifts', { openingFloat: 0 });

    const visit = async (tableId: string, customer: object) => {
      const order = await r.openAt(captain, tableId);
      await captain('POST', `/orders/${order.id}/items`, {
        items: [{ menuItemId: r.menu.naan.id, quantity: 2 }],
      });
      await captain('POST', `/orders/${order.id}/kots`);
      const invoice = BillResponseSchema.parse(
        (await cashier('POST', `/orders/${order.id}/invoice`, { customer })).json(),
      ).invoices[0]!;
      await cashier('POST', `/invoices/${invoice.id}/payments`, {
        payments: [{ method: 'CASH', amount: invoice.grandTotal }],
      });
      return invoice;
    };

    const first = await visit(r.tables.t1.id, { phone: '98300 12345', name: 'Sourav Ganguly' });
    expect(first).toMatchObject({ customerName: 'Sourav Ganguly' });
    expect(first.customerId).not.toBeNull();
    await visit(r.tables.t2.id, { phone: '+919830012345' });

    const found = CustomersResponseSchema.parse(
      (await cashier('GET', '/customers?q=12345')).json(),
    ).data;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      phone: '+919830012345',
      name: 'Sourav Ganguly',
      visitCount: 2,
      lifetimeValue: 25200,
    });

    const detail = CustomerDetailSchema.parse(
      (await cashier('GET', `/customers/${found[0]!.id}`)).json(),
    );
    expect(detail.recentInvoices).toHaveLength(2);
    expect(detail.favourites).toEqual([{ name: 'Butter Naan', quantity: 4 }]);

    expect((await cashier('POST', '/customers', { phone: '9830012345' })).json().code).toBe(
      'PHONE_TAKEN',
    );
    expect((await cashier('POST', '/customers', { phone: '12345' })).statusCode).toBe(422);
    expect((await captain('GET', '/customers?q=Sourav')).json().data[0].name).toBe(
      'Sourav Ganguly',
    );
  });
});
