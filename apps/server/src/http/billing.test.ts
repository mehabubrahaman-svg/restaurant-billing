import {
  BillPreviewResponseSchema,
  BillResponseSchema,
  FloorResponseSchema,
  InvoiceSchema,
  InvoicesResponseSchema,
  MenuItemSchema,
  OrderSchema,
  ShiftReportSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs, trail, type Call } from '../testing/staff';
import { ADMIN, type TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

async function billingSetup() {
  const r = await restaurantServer();
  s = r.s;
  const captain = await signInAs(r.s, r.admin, 'CAPTAIN', 'rahul');
  const cashier = await signInAs(r.s, r.admin, 'CASHIER', 'meera');
  /** An order at a table with 2 × Chicken Biryani (Full) + Raita and 4 × Butter Naan, sent to the kitchen. */
  const servedOrder = async (tableId = r.tables.t1.id) => {
    const order = await r.openAt(captain, tableId);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [
        {
          menuItemId: r.menu.biryani.id,
          variantId: r.menu.full.id,
          quantity: 2,
          addons: [{ addonId: r.menu.raita.id }],
        },
        { menuItemId: r.menu.naan.id, quantity: 4 },
      ],
    });
    await captain('POST', `/orders/${order.id}/kots`);
    return order;
  };
  const approval = async (call: Call, permission: string) => {
    const owner = (await call('GET', '/auth/pin-users'))
      .json()
      .data.find((u: { fullName: string }) => u.fullName === 'Ananya Sen');
    const res = await call('POST', '/auth/approve', {
      userId: owner.id,
      pin: ADMIN.pin,
      permission,
    });
    return { 'x-approver-token': res.json().approverToken as string };
  };
  return { ...r, captain, cashier, servedOrder, approval };
}

describe('billing', () => {
  it('bills an order with GST per line, takes a split payment and frees the table', async () => {
    const { cashier, captain, servedOrder, ok, s, menu } = await billingSetup();
    const order = await servedOrder();

    const preview = BillPreviewResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/bill-preview`, {})).json(),
    );
    expect(preview.invoices).toHaveLength(1);
    // 2 × ₹360 + 4 × ₹60 = ₹960; CGST 2.5% + SGST 2.5% = ₹48; ₹1,008
    expect(preview.invoices[0]).toMatchObject({
      subtotal: 96000,
      taxTotal: 4800,
      roundOff: 0,
      grandTotal: 100800,
    });
    expect(preview.invoices[0]!.taxes.map((t) => [t.code, t.rateBp, t.taxAmount])).toEqual([
      ['CGST', 250, 2400],
      ['SGST', 250, 2400],
    ]);

    const billed = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/invoice`, {})).json(),
    );
    const invoice = billed.invoices[0]!;
    expect(invoice).toMatchObject({
      invoiceNo: 'KOL1/2026-27/000001',
      series: 'INV',
      status: 'UNPAID',
      balance: 100800,
      tableLabel: 'T1',
    });
    expect((await ok(captain('GET', `/orders/${order.id}`), OrderSchema)).status).toBe('BILLED');
    // A billed order takes no more items.
    const more = await captain('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    expect(more.json().code).toBe('ORDER_NOT_OPEN');

    const pay = (payments: object[]) =>
      cashier('POST', `/invoices/${invoice.id}/payments`, { payments });
    expect((await pay([{ method: 'CASH', amount: 100800 }])).json().code).toBe('SHIFT_NOT_OPEN');
    await cashier('POST', '/cash-shifts', { openingFloat: 200000 });
    expect((await pay([{ method: 'UPI', amount: 100801, reference: 'RRN1' }])).json().code).toBe(
      'OVERPAYMENT',
    );

    const partly = InvoiceSchema.parse(
      (
        await pay([
          {
            method: 'CARD',
            amount: 50000,
            reference: 'AUTH123',
            cardLast4: '4242',
            terminalLabel: 'HDFC-1',
          },
        ])
      ).json(),
    );
    expect(partly).toMatchObject({ status: 'PARTIALLY_PAID', balance: 50800 });
    const paid = InvoiceSchema.parse(
      (await pay([{ method: 'CASH', amount: 50800, tendered: 60000 }])).json(),
    );
    expect(paid).toMatchObject({ status: 'PAID', balance: 0, paidTotal: 100800 });
    expect(paid.payments.map((p) => [p.method, p.amount, p.changeDue])).toEqual([
      ['CARD', 50000, null],
      ['CASH', 50800, 9200],
    ]);

    expect((await ok(captain('GET', `/orders/${order.id}`), OrderSchema)).status).toBe('PAID');
    const floor = FloorResponseSchema.parse((await captain('GET', '/floor')).json());
    expect(floor.areas[0]!.tables.find((t) => t.label === 'T1')).toMatchObject({
      status: 'CLEANING',
      openOrder: null,
    });
    expect(trail(s, invoice.id).events).toEqual([
      'InvoiceIssued',
      'PaymentRecorded',
      'PaymentRecorded',
      'InvoicePaid',
    ]);
  });

  it('needs everything sent before billing, and a manager above the discount limit', async () => {
    const { cashier, captain, servedOrder, approval, menu } = await billingSetup();
    const order = await servedOrder();
    await captain('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    expect((await cashier('POST', `/orders/${order.id}/invoice`, {})).json().code).toBe(
      'ORDER_HAS_UNSENT_ITEMS',
    );
    await captain('POST', `/orders/${order.id}/kots`);

    const big = { discount: { kind: 'PERCENT', value: 1500, reason: 'Regular guest' } };
    const denied = await cashier('POST', `/orders/${order.id}/invoice`, big);
    expect(denied.json()).toMatchObject({
      code: 'APPROVAL_REQUIRED',
      permission: 'billing.discount_override',
    });
    const ok = await cashier(
      'POST',
      `/orders/${order.id}/invoice`,
      big,
      await approval(cashier, 'billing.discount_override'),
    );
    expect(ok.statusCode).toBe(201);
    const invoice = BillResponseSchema.parse(ok.json()).invoices[0]!;
    // 15% of ₹1,020 = ₹153; ₹867 + 5% = ₹910.35 → ₹910
    expect(invoice).toMatchObject({
      discountTotal: 15300,
      taxableTotal: 86700,
      taxTotal: 4336,
      roundOff: -36,
      grandTotal: 91000,
    });
    expect(invoice.discounts).toEqual([
      { kind: 'PERCENT', value: 1500, amount: 15300, couponCode: null, reason: 'Regular guest' },
    ]);
  });

  it('bills liquor on its own gapless LIQ series', async () => {
    const { admin, cashier, captain, openAt, tables, menu, ok, servedOrder } = await billingSetup();
    const vat = (await admin('GET', '/tax-groups'))
      .json()
      .data.find((g: { taxType: string }) => g.taxType === 'VAT');
    const whisky = await ok(
      admin('POST', '/menu-items', {
        sku: 'WSK-60',
        name: 'Whisky 60 ml',
        categoryId: menu.category.id,
        foodType: 'NA',
        basePrice: 35000,
        taxGroupId: vat.id,
      }),
      MenuItemSchema,
    );
    const order = await openAt(captain, tables.t2.id);
    await captain('POST', `/orders/${order.id}/items`, {
      items: [
        { menuItemId: whisky.id, quantity: 2 },
        { menuItemId: menu.naan.id, quantity: 1 },
      ],
    });
    await captain('POST', `/orders/${order.id}/kots`);
    const { invoices } = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/invoice`, {})).json(),
    );
    expect(invoices.map((i) => [i.invoiceNo, i.series, i.grandTotal])).toEqual([
      ['KOL1/2026-27/000001', 'INV', 6300],
      ['KOL1/LIQ/2026-27/000001', 'LIQ', 84000], // ₹700 + 20% VAT
    ]);
    expect(invoices[1]!.taxes).toEqual([
      { code: 'VAT', rateBp: 2000, taxableValue: 70000, taxAmount: 14000 },
    ]);
    // The next food bill continues the INV series.
    const next = await servedOrder(tables.t3.id);
    const second = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${next.id}/invoice`, {})).json(),
    );
    expect(second.invoices[0]!.invoiceNo).toBe('KOL1/2026-27/000002');
  });

  it('cancels an unpaid bill with approval: the number stays used and the order reopens', async () => {
    const { cashier, captain, servedOrder, approval, ok } = await billingSetup();
    const order = await servedOrder();
    const first = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/invoice`, {})).json(),
    ).invoices[0]!;
    const body = { version: first.version, reason: 'Guest added dessert' };
    expect((await cashier('POST', `/invoices/${first.id}/cancel`, body)).json().code).toBe(
      'APPROVAL_REQUIRED',
    );
    const cancelled = InvoiceSchema.parse(
      (
        await cashier(
          'POST',
          `/invoices/${first.id}/cancel`,
          body,
          await approval(cashier, 'billing.cancel'),
        )
      ).json(),
    );
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Guest added dessert',
      balance: 0,
    });
    expect((await ok(captain('GET', `/orders/${order.id}`), OrderSchema)).status).toBe('OPEN');
    const again = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/invoice`, {})).json(),
    ).invoices[0]!;
    expect(again.invoiceNo).toBe('KOL1/2026-27/000002');
    const list = InvoicesResponseSchema.parse((await cashier('GET', '/invoices')).json()).data;
    expect(list.map((i) => [i.invoiceNo, i.status])).toEqual([
      ['KOL1/2026-27/000002', 'UNPAID'],
      ['KOL1/2026-27/000001', 'CANCELLED'],
    ]);
  });

  it('refunds a line with a credit note and closes the shift with per-tender variances', async () => {
    const { cashier, admin, servedOrder } = await billingSetup();
    const order = await servedOrder();
    const invoice = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/invoice`, {})).json(),
    ).invoices[0]!;
    const shift = ShiftReportSchema.parse(
      (await cashier('POST', '/cash-shifts', { openingFloat: 200000 })).json(),
    );
    expect((await cashier('POST', '/cash-shifts', { openingFloat: 0 })).json().code).toBe(
      'SHIFT_ALREADY_OPEN',
    );
    await cashier('POST', `/invoices/${invoice.id}/payments`, {
      payments: [
        { method: 'UPI', amount: 60000, reference: 'RRN998877', terminalLabel: 'Paytm' },
        { method: 'CASH', amount: 40800, tendered: 50000 },
      ],
    });

    const naan = invoice.lines.find((l) => l.description === 'Butter Naan')!;
    const refundBody = {
      lines: [{ invoiceLineId: naan.id, quantity: 1 }],
      method: 'CASH',
      reason: 'Naan was burnt',
    };
    expect((await cashier('POST', `/invoices/${invoice.id}/refunds`, refundBody)).json().code).toBe(
      'APPROVAL_REQUIRED',
    );
    const adminShift = await admin('POST', '/cash-shifts', { openingFloat: 0 });
    expect(adminShift.statusCode).toBe(201);
    const refund = await admin('POST', `/invoices/${invoice.id}/refunds`, refundBody);
    expect(refund.statusCode).toBe(201);
    const { creditNote, invoice: after } = refund.json();
    expect(creditNote).toMatchObject({
      invoiceNo: 'KOL1/CN/2026-27/000001',
      kind: 'CREDIT_NOTE',
      grandTotal: 6300,
      status: 'PAID',
    });
    expect(creditNote.payments).toEqual([
      expect.objectContaining({ method: 'CASH', amount: -6300 }),
    ]);
    expect(after).toMatchObject({ status: 'PARTIALLY_REFUNDED' });

    const x = ShiftReportSchema.parse((await cashier('GET', '/cash-shifts/current')).json());
    expect(x).toMatchObject({
      id: shift.id,
      status: 'OPEN',
      expectedCash: 240800,
      sales: 100800,
      refunds: 0,
      invoiceCount: 1,
    });

    const closed = ShiftReportSchema.parse(
      (
        await cashier('POST', `/cash-shifts/${shift.id}/close`, {
          version: x.version,
          countedCash: 240000,
          denominations: { '500': 4, '200': 2 }, // ₹2,400
          tenders: [{ method: 'UPI', terminalLabel: 'Paytm', reportedAmount: 60000 }],
        })
      ).json(),
    );
    expect(closed).toMatchObject({
      status: 'CLOSED',
      expectedCash: 240800,
      countedCash: 240000,
      cashVariance: -800,
    });
    expect(closed.tenders).toEqual([
      { method: 'CASH', terminalLabel: '', expected: 240800, reported: 240000, variance: -800 },
      { method: 'UPI', terminalLabel: 'Paytm', expected: 60000, reported: 60000, variance: 0 },
    ]);
    expect((await cashier('GET', '/cash-shifts/current')).statusCode).toBe(404);
  });

  it('makes a complimentary bill free with approval and rejects unknown coupons', async () => {
    const { cashier, captain, servedOrder, approval, ok } = await billingSetup();
    const order = await servedOrder();
    expect(
      (await cashier('POST', `/orders/${order.id}/bill-preview`, { couponCode: 'NOPE' })).json()
        .code,
    ).toBe('COUPON_INVALID');
    const comp = { complimentary: { reason: 'Owner’s guests' } };
    expect((await cashier('POST', `/orders/${order.id}/invoice`, comp)).json()).toMatchObject({
      permission: 'billing.complimentary',
    });
    const free = BillResponseSchema.parse(
      (
        await cashier(
          'POST',
          `/orders/${order.id}/invoice`,
          comp,
          await approval(cashier, 'billing.complimentary'),
        )
      ).json(),
    ).invoices[0]!;
    expect(free).toMatchObject({ grandTotal: 0, taxTotal: 0, status: 'PAID' });
    expect((await ok(captain('GET', `/orders/${order.id}`), OrderSchema)).status).toBe('PAID');
  });
});

describe('coupons', () => {
  it('creates a coupon that the cashier can apply once its minimum is met', async () => {
    const { admin, cashier, servedOrder } = await billingSetup();
    const created = await admin('POST', '/coupons', {
      code: 'diwali20',
      kind: 'PERCENT',
      value: 2000,
      maxDiscount: 15000,
      minBill: 50000,
      usageLimit: 1,
    });
    expect(created.json()).toMatchObject({ code: 'DIWALI20', usedCount: 0, isActive: true });
    expect(
      (await admin('POST', '/coupons', { code: 'DIWALI20', kind: 'FIXED', value: 100 })).json()
        .code,
    ).toBe('DUPLICATE_NAME');
    expect((await cashier('GET', '/coupons')).statusCode).toBe(403);

    const order = await servedOrder();
    const { invoices } = BillResponseSchema.parse(
      (await cashier('POST', `/orders/${order.id}/invoice`, { couponCode: 'Diwali20' })).json(),
    );
    // 20% of ₹960 = ₹192, capped at ₹150
    expect(invoices[0]!.discounts).toEqual([
      { kind: 'COUPON', value: 2000, amount: 15000, couponCode: 'DIWALI20', reason: null },
    ]);
    expect((await admin('GET', '/coupons')).json().data[0].usedCount).toBe(1);
  });
});
