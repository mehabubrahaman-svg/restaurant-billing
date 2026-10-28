import {
  BillResponseSchema,
  FireKotsResponseSchema,
  InvoiceSchema,
  SalesChannelSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

describe('aggregator orders (manual entry)', () => {
  it('prices at the channel markup, refuses duplicates and charges no GST when the operator pays it', async () => {
    const r = await restaurantServer();
    s = r.s;
    const cashier = await signInAs(r.s, r.admin, 'CASHIER', 'meera');
    const swiggy = SalesChannelSchema.parse(
      (
        await r.admin('POST', '/sales-channels', {
          code: 'swiggy',
          name: 'Swiggy',
          commissionBp: 2200,
          priceMarkupBp: 1000,
        })
      ).json(),
    );
    expect(swiggy).toMatchObject({
      code: 'SWIGGY',
      kind: 'AGGREGATOR',
      integration: 'MANUAL',
      gstPaidByOperator: true,
    });
    expect(
      (await cashier('GET', '/sales-channels')).json().data.map((c: { code: string }) => c.code),
    ).toEqual(['DIRECT', 'SWIGGY']);

    const body = {
      salesChannelId: swiggy.id,
      externalOrderId: 'SWG-7734512',
      externalOtp: '4471',
      items: [{ menuItemId: r.menu.naan.id, quantity: 2 }],
    };
    const created = FireKotsResponseSchema.parse(
      (await cashier('POST', '/orders/aggregator', body)).json(),
    );
    expect(created.order).toMatchObject({
      orderType: 'DELIVERY',
      tokenNo: 1,
      salesChannelName: 'Swiggy',
      externalOrderId: 'SWG-7734512',
      subtotal: 13200, // ₹60 + 10% = ₹66 each
    });
    expect(created.kots).toHaveLength(1);
    expect((await cashier('POST', '/orders/aggregator', body)).json().code).toBe(
      'DUPLICATE_EXTERNAL_ORDER',
    );

    const invoice = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${created.order.id}/invoice`, {})).json(),
    ).invoices[0]!;
    expect(invoice).toMatchObject({
      gstPaidByOperator: true,
      taxTotal: 0,
      grandTotal: 13200,
      taxes: [],
    });
    const paid = InvoiceSchema.parse(
      (
        await cashier('POST', `/invoices/${invoice.id}/payments`, {
          payments: [{ method: 'AGGREGATOR', amount: 13200, reference: 'SWG-7734512' }],
        })
      ).json(),
    );
    expect(paid.status).toBe('PAID');
  });

  it('refuses liquor on a delivery-app order, at entry and when items are added later', async () => {
    const r = await restaurantServer();
    s = r.s;
    const swiggy = (
      await r.admin('POST', '/sales-channels', {
        code: 'swiggy',
        name: 'Swiggy',
        commissionBp: 2200,
      })
    ).json();
    const vat = (await r.admin('GET', '/tax-groups'))
      .json()
      .data.find((g: { taxType: string }) => g.taxType === 'VAT');
    const beer = (
      await r.admin('POST', '/menu-items', {
        sku: 'BEER-650',
        name: 'Beer 650 ml',
        categoryId: r.menu.category.id,
        foodType: 'NA',
        basePrice: 32000,
        taxGroupId: vat.id,
      })
    ).json();

    const refused = await r.admin('POST', '/orders/aggregator', {
      salesChannelId: swiggy.id,
      externalOrderId: 'SWG-1',
      items: [
        { menuItemId: r.menu.naan.id, quantity: 2 },
        { menuItemId: beer.id, quantity: 1 },
      ],
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({
      code: 'LIQUOR_NOT_FOR_DELIVERY',
      detail: "Beer 650 ml is liquor and can't be sold through a delivery app",
    });

    // Nothing was saved, so the same Swiggy order goes through without the beer.
    const created = FireKotsResponseSchema.parse(
      (
        await r.admin('POST', '/orders/aggregator', {
          salesChannelId: swiggy.id,
          externalOrderId: 'SWG-1',
          items: [{ menuItemId: r.menu.naan.id, quantity: 2 }],
        })
      ).json(),
    );
    const later = await r.admin('POST', `/orders/${created.order.id}/items`, {
      items: [{ menuItemId: beer.id, quantity: 1 }],
    });
    expect(later.json().code).toBe('LIQUOR_NOT_FOR_DELIVERY');

    // A dine-in table can still order it.
    const table = await r.openAt(r.admin, r.tables.t1.id);
    const ordered = await r.admin('POST', `/orders/${table.id}/items`, {
      items: [{ menuItemId: beer.id, quantity: 1 }],
    });
    expect(ordered.statusCode).toBe(200);
  });
});
