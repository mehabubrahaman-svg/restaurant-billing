import {
  BillResponseSchema,
  FireKotsResponseSchema,
  Gstr1Schema,
  Gstr3bSchema,
  MenuItemSchema,
  OrderSchema,
  VatRegisterSchema,
  type Invoice,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

const BUYER_GSTIN = '19AABCU9603R1ZK';
const SWIGGY_GSTIN = '29AAFCB7707D1ZQ';
const RANGE = 'from=2026-10-01&to=2026-10-31';

/**
 * October on one day (West Bengal, food at 5%):
 * - a dine-in bill to a guest, ₹1,008, one naan refunded;
 * - a bill to a registered business, two naan (₹126), one refunded;
 * - a Swiggy order (₹132), whose GST Swiggy pays;
 * - a liquor bill (₹840 with 20% VAT);
 * - a cancelled bill.
 */
async function month() {
  const r = await restaurantServer();
  s = r.s;
  const { admin, menu, tables, openAt, ok } = r;
  await admin('POST', '/cash-shifts', { openingFloat: 0 });
  const bill = async (orderId: string, body: object = {}): Promise<Invoice[]> =>
    BillResponseSchema.parse((await admin('POST', `/orders/${orderId}/invoice`, body)).json())
      .invoices;
  const pay = (invoice: Invoice) =>
    admin('POST', `/invoices/${invoice.id}/payments`, {
      payments: [{ method: 'CASH', amount: invoice.grandTotal }],
    });
  const refundOneNaan = (invoice: Invoice) =>
    admin('POST', `/invoices/${invoice.id}/refunds`, {
      lines: [
        {
          invoiceLineId: invoice.lines.find((l) => l.description.startsWith('Butter Naan'))!.id,
          quantity: 1,
        },
      ],
      method: 'CASH',
      reason: 'Naan was burnt',
    });

  const dineIn = await openAt(admin, tables.t1.id, 3);
  await admin('POST', `/orders/${dineIn.id}/items`, {
    items: [
      {
        menuItemId: menu.biryani.id,
        variantId: menu.full.id,
        quantity: 2,
        addons: [{ addonId: menu.raita.id }],
      },
      { menuItemId: menu.naan.id, quantity: 4 },
    ],
  });
  await admin('POST', `/orders/${dineIn.id}/kots`);
  const [guestBill] = await bill(dineIn.id);
  await pay(guestBill!);
  expect((await refundOneNaan(guestBill!)).statusCode).toBe(201);

  const business = await openAt(admin, tables.t2.id, 2);
  await admin('POST', `/orders/${business.id}/items`, {
    items: [{ menuItemId: menu.naan.id, quantity: 2 }],
  });
  await admin('POST', `/orders/${business.id}/kots`);
  const [b2bBill] = await bill(business.id, {
    customer: { phone: '9830011111', name: 'Acme Pvt Ltd', taxId: BUYER_GSTIN },
  });
  expect(b2bBill).toMatchObject({ grandTotal: 12600 });
  await pay(b2bBill!);
  expect((await refundOneNaan(b2bBill!)).statusCode).toBe(201);

  const swiggy = (
    await admin('POST', '/sales-channels', {
      code: 'swiggy',
      name: 'Swiggy',
      commissionBp: 2200,
      priceMarkupBp: 1000,
      operatorGstin: SWIGGY_GSTIN,
    })
  ).json();
  expect(swiggy.operatorGstin).toBe(SWIGGY_GSTIN);
  const delivery = FireKotsResponseSchema.parse(
    (
      await admin('POST', '/orders/aggregator', {
        salesChannelId: swiggy.id,
        externalOrderId: 'SWG-1',
        items: [{ menuItemId: menu.naan.id, quantity: 2 }],
      })
    ).json(),
  );
  const [swiggyBill] = await bill(delivery.order.id);
  await admin('POST', `/invoices/${swiggyBill!.id}/payments`, {
    payments: [{ method: 'AGGREGATOR', amount: swiggyBill!.grandTotal, reference: 'SWG-1' }],
  });

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
  const bar = await openAt(admin, tables.t3.id, 2);
  await admin('POST', `/orders/${bar.id}/items`, {
    items: [{ menuItemId: whisky.id, quantity: 2 }],
  });
  await admin('POST', `/orders/${bar.id}/kots`);
  const liquor = await bill(bar.id);
  expect(liquor.map((i) => [i.series, i.grandTotal])).toEqual([['LIQ', 84000]]);
  await pay(liquor[0]!);

  // A bill raised and cancelled: only the documents-issued table counts it.
  const wrong = await ok(admin('POST', '/orders', { orderType: 'TAKEAWAY' }), OrderSchema);
  await admin('POST', `/orders/${wrong.id}/items`, {
    items: [{ menuItemId: menu.naan.id, quantity: 1 }],
  });
  await admin('POST', `/orders/${wrong.id}/kots`);
  const [cancelled] = await bill(wrong.id);
  await admin('POST', `/invoices/${cancelled!.id}/cancel`, {
    version: cancelled!.version,
    reason: 'Wrong table billed',
  });
  return { ...r, b2bBill: b2bBill! };
}

describe('GST returns', () => {
  it('builds GSTR-1 section by section, GSTR-3B and the liquor VAT register', async () => {
    const { admin, b2bBill } = await month();

    const gstr1 = Gstr1Schema.parse((await admin('GET', `/reports/gstr1?${RANGE}`)).json());
    expect(gstr1).toMatchObject({ stateCode: '19', stateName: 'West Bengal' });
    expect(gstr1.stateNames['19']).toBe('West Bengal');
    expect(gstr1.b2b).toEqual([
      {
        gstin: BUYER_GSTIN,
        receiverName: 'Acme Pvt Ltd',
        invoiceNo: b2bBill.invoiceNo,
        invoiceDate: '2026-10-28',
        invoiceValue: 12600,
        placeOfSupply: '19',
        rateBp: 500,
        taxable: 12000,
        igst: 0,
        cgst: 300,
        sgst: 300,
        cess: 0,
      },
    ]);
    // The guest's bill less its credit note; the business's credit note is in CDNR.
    expect(gstr1.b2cs).toEqual([
      {
        placeOfSupply: '19',
        rateBp: 500,
        taxable: 90000,
        igst: 0,
        cgst: 2250,
        sgst: 2250,
        cess: 0,
      },
    ]);
    expect(gstr1.cdnr).toEqual([
      expect.objectContaining({
        gstin: BUYER_GSTIN,
        noteValue: 6300,
        originalInvoiceNo: b2bBill.invoiceNo,
        rateBp: 500,
        taxable: 6000,
        cgst: 150,
        sgst: 150,
      }),
    ]);
    expect(gstr1.b2cl).toEqual([]);
    expect(gstr1.cdnur).toEqual([]);
    // Liquor is a non-GST supply.
    expect(gstr1.exempt.find((e) => e.kind === 'INTRA_UNREGISTERED')).toEqual({
      kind: 'INTRA_UNREGISTERED',
      nilRated: 0,
      exempted: 0,
      nonGst: 70000,
    });
    // The HSN summary is net of credit notes, apart for B2B and B2C.
    const sum = (rows: { taxable: number }[]) => rows.reduce((n, h) => n + h.taxable, 0);
    expect(sum(gstr1.hsn.b2c)).toBe(90000);
    expect(sum(gstr1.hsn.b2b)).toBe(6000);
    expect(gstr1.docs).toEqual([
      expect.objectContaining({ nature: 'INVOICE', series: 'INV', total: 4, cancelled: 1 }),
      expect.objectContaining({ nature: 'INVOICE', series: 'LIQ', total: 1, cancelled: 0 }),
      expect.objectContaining({ nature: 'CREDIT_NOTE', series: 'CN', total: 2, cancelled: 0 }),
    ]);
    expect(gstr1.eco).toEqual([
      { operator: 'Swiggy', operatorGstin: SWIGGY_GSTIN, taxable: 13200 },
    ]);

    const gstr3b = Gstr3bSchema.parse((await admin('GET', `/reports/gstr3b?${RANGE}`)).json());
    expect(gstr3b.outward).toEqual({
      taxable: { taxable: 96000, igst: 0, cgst: 2400, sgst: 2400, cess: 0 },
      zeroRated: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
      nilExempt: 0,
      reverseCharge: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
      nonGst: 70000,
    });
    expect(gstr3b.ecoSupplies).toBe(13200);
    expect(gstr3b.interStateUnregistered).toEqual([]);
    // Food at 5% only: no input tax credit, everything is payable.
    expect(gstr3b.itc.allowed).toBe(false);
    expect(gstr3b.payable).toEqual({ igst: 0, cgst: 2400, sgst: 2400, cess: 0 });

    const vat = VatRegisterSchema.parse(
      (await admin('GET', `/reports/vat-register?${RANGE}`)).json(),
    );
    expect(vat.rows).toEqual([
      expect.objectContaining({
        kind: 'INVOICE',
        rateBp: 2000,
        taxable: 70000,
        vat: 14000,
        surcharge: 0,
        total: 84000,
      }),
    ]);
    expect(vat.byRate).toEqual([
      { rateBp: 2000, bills: 1, taxable: 70000, vat: 14000, surcharge: 0, total: 84000 },
    ]);

    // Downloads: the workbook, and one section for the GST offline tool.
    const xlsx = await admin('GET', `/reports/gstr1.xlsx?${RANGE}`);
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.headers['content-disposition']).toContain('gstr1-2026-10-01-to-2026-10-31.xlsx');
    const b2cs = await admin('GET', `/reports/gstr1/b2cs.csv?${RANGE}`);
    expect(b2cs.body.split('\r\n').slice(0, 2)).toEqual([
      '﻿Type,Place Of Supply,Applicable % of Tax Rate,Rate,Taxable Value,Cess Amount,E-Commerce GSTIN',
      'OE,19-West Bengal,,5.00,900.00,0.00,',
    ]);
    expect((await admin('GET', `/reports/gstr1/nope.csv?${RANGE}`)).statusCode).toBe(404);
    expect((await admin('GET', `/reports/gstr3b.csv?${RANGE}`)).body).toContain(
      '3.1(e),Non-GST outward supplies,700.00',
    );
    expect((await admin('GET', `/reports/vat-register.xlsx?${RANGE}`)).statusCode).toBe(200);
  });

  it('is for staff with reports.financial only', async () => {
    const r = await restaurantServer();
    s = r.s;
    const cashier = await signInAs(r.s, r.admin, 'CASHIER', 'meera');
    const accountant = await signInAs(r.s, r.admin, 'ACCOUNTANT', 'gita');
    expect((await cashier('GET', `/reports/gstr1?${RANGE}`)).statusCode).toBe(403);
    expect((await accountant('GET', `/reports/gstr3b?${RANGE}`)).statusCode).toBe(200);
    expect(
      (await accountant('GET', '/reports/gstr1?from=2025-01-01&to=2026-10-31')).json().code,
    ).toBe('VALIDATION_FAILED');
  });
});
