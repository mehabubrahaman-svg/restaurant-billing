import {
  GrnSchema,
  InventoryItemSchema,
  PurchaseOrderSchema,
  StockMovementsResponseSchema,
  VendorDuesReportSchema,
  VendorPaymentSchema,
  VendorSchema,
  VendorsResponseSchema,
  VendorStatementSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs, trail } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

const KG = 1_000_000;

/**
 * The restaurant plus rice (kept in g, bought in kg), eggs (kept in pieces,
 * bought by the dozen) and chicken, and three vendors: one in West Bengal
 * (the branch's state), one in Delhi and one unregistered.
 */
async function purchasing() {
  const r = await restaurantServer();
  s = r.s;
  const { admin, ok } = r;
  const item = (body: object) => ok(admin('POST', '/inventory-items', body), InventoryItemSchema);
  const rice = await item({
    sku: 'RICE',
    name: 'Basmati rice',
    baseUnit: 'g',
    purchaseUnitId: 'unit-kg',
  });
  const eggs = await item({
    sku: 'EGG',
    name: 'Eggs',
    baseUnit: 'pc',
    purchaseUnitId: 'unit-dozen',
  });
  const chicken = await item({
    sku: 'CHK',
    name: 'Chicken',
    baseUnit: 'g',
    isPerishable: true,
    shelfLifeDays: 2,
  });
  const vendor = (body: object) => ok(admin('POST', '/vendors', body), VendorSchema);
  const farms = await vendor({
    code: 'FRESH',
    name: 'Fresh Farms',
    phone: '+91 98300 12345',
    taxId: '19AAACF1234A1Z5',
    paymentTermsDays: 15,
  });
  const delhi = await vendor({
    code: 'DSP',
    name: 'Delhi Spices',
    taxId: '07AAACD1234B1Z2',
    paymentTermsDays: 30,
  });
  const market = await vendor({ code: 'MKT', name: 'New Market stall' });
  const stock = (i: { id: string }) =>
    ok(admin('GET', `/inventory-items/${i.id}`), InventoryItemSchema);
  return { ...r, items: { rice, eggs, chicken }, vendors: { farms, delhi, market }, stock };
}

describe('purchasing', () => {
  it('keeps vendors with their GSTIN, terms and what is owed', async () => {
    const { admin, vendors } = await purchasing();
    expect(vendors.farms).toMatchObject({
      code: 'FRESH',
      taxId: '19AAACF1234A1Z5',
      due: 0,
      isActive: true,
    });
    const dup = await admin('POST', '/vendors', { code: 'fresh', name: 'Another' });
    expect([dup.statusCode, dup.json().code]).toEqual([409, 'VENDOR_CODE_TAKEN']);
    const bad = await admin('POST', '/vendors', { code: 'X1', name: 'X', taxId: '19ABC' });
    expect(bad.json().code).toBe('VALIDATION_FAILED');

    const retired = VendorSchema.parse(
      (
        await admin('PATCH', `/vendors/${vendors.market.id}`, {
          version: vendors.market.version,
          isActive: false,
        })
      ).json(),
    );
    expect(retired.isActive).toBe(false);
    const list = VendorsResponseSchema.parse((await admin('GET', '/vendors')).json());
    expect(list.data.map((v) => v.code)).toEqual(['DSP', 'FRESH']);
    // A retired vendor takes no new orders.
    const po = await admin('POST', '/purchase-orders', {
      vendorId: vendors.market.id,
      lines: [
        {
          inventoryItemId: '01900000-0000-7000-8000-000000000000',
          unitId: 'unit-kg',
          quantityMilli: 1,
          unitPrice: 1,
        },
      ],
    });
    expect(po.json().code).toBe('VALIDATION_FAILED');
  });

  it('runs a PO through approval, partial and final receipts into stock, and closes it', async () => {
    const { admin, ok, items, vendors, stock, s } = await purchasing();
    const store = await signInAs(s, admin, 'INVENTORY', 'gopal');

    let po = await ok(
      store('POST', '/purchase-orders', {
        vendorId: vendors.farms.id,
        expectedOn: '2026-10-30',
        lines: [
          // 25 kg rice at ₹90/kg + 5% GST; 10 dozen eggs at ₹78.50 a dozen, no GST
          {
            inventoryItemId: items.rice.id,
            unitId: 'unit-kg',
            quantityMilli: 25_000,
            unitPrice: 9_000,
            taxRateBp: 500,
          },
          {
            inventoryItemId: items.eggs.id,
            unitId: 'unit-dozen',
            quantityMilli: 10_000,
            unitPrice: 7_850,
          },
        ],
      }),
      PurchaseOrderSchema,
    );
    expect(po).toMatchObject({
      poNo: 'KOL1/PO/2026-27/000001',
      status: 'DRAFT',
      subtotal: 303_500,
      taxTotal: 11_250,
      grandTotal: 314_750,
      createdByName: 'gopal',
    });
    expect(po.lines.map((l) => [l.unitCode, l.value, l.taxAmount])).toEqual([
      ['kg', 225_000, 11_250],
      ['dozen', 78_500, 0],
    ]);
    const wrongUnit = await store('PATCH', `/purchase-orders/${po.id}`, {
      version: po.version,
      lines: [
        { inventoryItemId: items.eggs.id, unitId: 'unit-kg', quantityMilli: 1_000, unitPrice: 100 },
      ],
    });
    expect([wrongUnit.statusCode, wrongUnit.json().code]).toEqual([422, 'UNIT_MISMATCH']);

    // Nothing can be received before approval, and stock staff can't approve.
    const early = await store('POST', '/grns', {
      purchaseOrderId: po.id,
      lines: [
        {
          inventoryItemId: items.rice.id,
          unitId: 'unit-kg',
          quantityMilli: 1_000,
          unitPrice: 9_000,
        },
      ],
    });
    expect(early.json().code).toBe('INVALID_STATE_TRANSITION');
    expect(
      (await store('POST', `/purchase-orders/${po.id}/approve`, { version: po.version }))
        .statusCode,
    ).toBe(403);
    po = await ok(
      admin('POST', `/purchase-orders/${po.id}/approve`, { version: po.version }),
      PurchaseOrderSchema,
    );
    expect(po).toMatchObject({ status: 'APPROVED', approvedByName: 'Ananya Sen' });
    po = await ok(
      store('POST', `/purchase-orders/${po.id}/send`, { version: po.version }),
      PurchaseOrderSchema,
    );
    expect(po.status).toBe('SENT');
    const edit = await store('PATCH', `/purchase-orders/${po.id}`, {
      version: po.version,
      notes: 'x',
    });
    expect(edit.json().code).toBe('INVALID_STATE_TRANSITION');

    // 20 kg of rice arrive; of the 10 dozen eggs one dozen is broken and sent back.
    const [riceLine, eggLine] = po.lines;
    let grn = await ok(
      store('POST', '/grns', {
        purchaseOrderId: po.id,
        vendorInvoiceNo: 'FF/1123',
        lines: [
          {
            purchaseOrderLineId: riceLine!.id,
            inventoryItemId: items.rice.id,
            unitId: 'unit-kg',
            quantityMilli: 20_000,
            unitPrice: 9_000,
            taxRateBp: 500,
            batchNo: 'B-11',
            expiresOn: '2027-04-30',
          },
          {
            purchaseOrderLineId: eggLine!.id,
            inventoryItemId: items.eggs.id,
            unitId: 'unit-dozen',
            quantityMilli: 10_000,
            rejectedQtyMilli: 1_000,
            unitPrice: 7_850,
          },
        ],
      }),
      GrnSchema,
    );
    expect(grn).toMatchObject({
      grnNo: 'KOL1/GRN/2026-27/000001',
      status: 'DRAFT',
      vendorName: 'Fresh Farms',
      poNo: 'KOL1/PO/2026-27/000001',
      // 20 kg × ₹90 + 5% = ₹1,890; 9 dozen × ₹78.50 = ₹706.50
      subtotal: 250_650,
      taxTotal: 9_000,
      grandTotal: 259_650,
    });
    expect((await stock(items.rice)).qtyMilli).toBe(0);
    grn = await ok(store('POST', `/grns/${grn.id}/post`, { version: grn.version }), GrnSchema);
    expect(grn).toMatchObject({
      status: 'POSTED',
      dueOn: '2026-11-12',
      inputTaxKind: 'CGST_SGST',
      balance: 259_650,
      postedByName: 'gopal',
    });
    expect(grn.lines.map((l) => l.acceptedQtyMilli)).toEqual([20_000, 9_000]);
    // Into stock in the base unit, at the price before GST (it is claimed back).
    expect(await stock(items.rice)).toMatchObject({ qtyMilli: 20 * KG, avgCostPerBase: 9_000 });
    expect(await stock(items.eggs)).toMatchObject({ qtyMilli: 108_000, avgCostPerBase: 654_167 });
    const movements = StockMovementsResponseSchema.parse(
      (await admin('GET', `/stock/movements?inventoryItemId=${items.rice.id}`)).json(),
    ).data;
    expect(movements).toEqual([
      expect.objectContaining({
        type: 'PURCHASE',
        qtyMilli: 20 * KG,
        referenceType: 'GRN_LINE',
        referenceId: grn.lines[0]!.id,
        batchNo: 'B-11',
      }),
    ]);
    expect(trail(s, grn.id)).toEqual({
      audit: ['purchase.grn.create', 'purchase.grn.post'],
      events: ['GrnCreated', 'GrnPosted'],
      queued: 2,
    });

    po = await ok(admin('GET', `/purchase-orders/${po.id}`), PurchaseOrderSchema);
    expect(po.status).toBe('PARTIALLY_RECEIVED');
    expect(po.lines.map((l) => l.receivedQtyMilli)).toEqual([20_000, 9_000]);
    expect(po.grns).toEqual([expect.objectContaining({ id: grn.id, status: 'POSTED' })]);
    // Posted GRNs are final.
    expect(
      (await store('POST', `/grns/${grn.id}/post`, { version: grn.version })).json().code,
    ).toBe('INVALID_STATE_TRANSITION');
    const cancel = await store('POST', `/purchase-orders/${po.id}/cancel`, {
      version: po.version,
      reason: 'No longer needed',
    });
    expect(cancel.json().code).toBe('INVALID_STATE_TRANSITION');

    // The rest of the rice; the broken eggs won't be replaced, so the PO is closed short.
    const second = await ok(
      store('POST', '/grns', {
        purchaseOrderId: po.id,
        lines: [
          {
            purchaseOrderLineId: riceLine!.id,
            inventoryItemId: items.rice.id,
            unitId: 'unit-kg',
            quantityMilli: 5_000,
            unitPrice: 9_000,
            taxRateBp: 500,
          },
        ],
      }),
      GrnSchema,
    );
    await ok(store('POST', `/grns/${second.id}/post`, { version: second.version }), GrnSchema);
    po = await ok(admin('GET', `/purchase-orders/${po.id}`), PurchaseOrderSchema);
    expect(po.status).toBe('PARTIALLY_RECEIVED');
    po = await ok(
      store('POST', `/purchase-orders/${po.id}/close`, { version: po.version }),
      PurchaseOrderSchema,
    );
    expect(po.status).toBe('CLOSED');
    expect((await stock(items.rice)).qtyMilli).toBe(25 * KG);
    const late = await store('POST', '/grns', {
      purchaseOrderId: po.id,
      lines: [
        {
          inventoryItemId: items.eggs.id,
          unitId: 'unit-dozen',
          quantityMilli: 1_000,
          unitPrice: 7_850,
        },
      ],
    });
    expect(late.json().code).toBe('INVALID_STATE_TRANSITION');
  });

  it('claims GST by the vendor’s state, and costs stock with the tax when there is no credit', async () => {
    const { admin, ok, items, vendors, stock } = await purchasing();
    const receive = async (vendorId: string) => {
      const grn = await ok(
        admin('POST', '/grns', {
          vendorId,
          lines: [
            {
              inventoryItemId: items.chicken.id,
              unitId: 'unit-kg',
              quantityMilli: 5_000,
              unitPrice: 24_000,
              taxRateBp: 500,
            },
          ],
        }),
        GrnSchema,
      );
      return ok(admin('POST', `/grns/${grn.id}/post`, { version: grn.version }), GrnSchema);
    };
    // Unregistered: ₹1,200 + ₹60 tax that can't be claimed = ₹252/kg in stock.
    const local = await admin('POST', '/grns', { vendorId: vendors.market.id, lines: [] });
    expect(local.json().code).toBe('VALIDATION_FAILED');
    expect((await receive(vendors.market.id)).inputTaxKind).toBe('NONE');
    expect(await stock(items.chicken)).toMatchObject({ qtyMilli: 5 * KG, avgCostPerBase: 25_200 });
    // From Delhi: IGST, and the stock cost is the price before tax.
    const igst = await receive(vendors.delhi.id);
    expect(igst).toMatchObject({ inputTaxKind: 'IGST', dueOn: '2026-11-27', grandTotal: 126_000 });
    expect(await stock(items.chicken)).toMatchObject({ qtyMilli: 10 * KG, avgCostPerBase: 24_600 });
    // Perishable with no expiry given: the batch takes the shelf life.
    const alerts = (await admin('GET', '/stock/alerts')).json();
    expect(alerts.expiring.map((b: { expiresOn: string }) => b.expiresOn)).toEqual([
      '2026-10-30',
      '2026-10-30',
    ]);
  });

  it('refuses impossible dates, and a delivery rejected in full leaves the PO as it was', async () => {
    const { admin, ok, items, vendors } = await purchasing();
    const badDate = await admin('POST', '/vendor-payments', {
      vendorId: vendors.farms.id,
      method: 'CASH',
      amount: 100,
      paidOn: '2026-09-31',
    });
    expect(badDate.json().code).toBe('VALIDATION_FAILED');
    let po = await ok(
      admin('POST', '/purchase-orders', {
        vendorId: vendors.farms.id,
        lines: [
          {
            inventoryItemId: items.rice.id,
            unitId: 'unit-kg',
            quantityMilli: 10_000,
            unitPrice: 9_000,
          },
        ],
      }),
      PurchaseOrderSchema,
    );
    po = await ok(
      admin('POST', `/purchase-orders/${po.id}/approve`, { version: po.version }),
      PurchaseOrderSchema,
    );
    const grn = await ok(
      admin('POST', '/grns', {
        purchaseOrderId: po.id,
        vendorInvoiceDate: '2026-10-27',
        lines: [
          {
            purchaseOrderLineId: po.lines[0]!.id,
            inventoryItemId: items.rice.id,
            unitId: 'unit-kg',
            quantityMilli: 10_000,
            rejectedQtyMilli: 10_000,
            unitPrice: 9_000,
          },
        ],
      }),
      GrnSchema,
    );
    await ok(admin('POST', `/grns/${grn.id}/post`, { version: grn.version }), GrnSchema);
    po = await ok(admin('GET', `/purchase-orders/${po.id}`), PurchaseOrderSchema);
    expect(po.status).toBe('APPROVED');
    const bad = await admin('POST', '/grns', {
      vendorId: vendors.farms.id,
      vendorInvoiceDate: '2026-13-01',
      lines: [
        {
          inventoryItemId: items.rice.id,
          unitId: 'unit-kg',
          quantityMilli: 1_000,
          unitPrice: 9_000,
        },
      ],
    });
    expect(bad.json().code).toBe('VALIDATION_FAILED');
  });

  it('edits and cancels a draft GRN, and checks its lines', async () => {
    const { admin, ok, items, vendors } = await purchasing();
    const line = {
      inventoryItemId: items.rice.id,
      unitId: 'unit-kg',
      quantityMilli: 10_000,
      unitPrice: 8_500,
    };
    const rejected = await admin('POST', '/grns', {
      vendorId: vendors.farms.id,
      lines: [{ ...line, rejectedQtyMilli: 11_000 }],
    });
    expect(rejected.json().code).toBe('VALIDATION_FAILED');
    let grn = await ok(
      admin('POST', '/grns', { vendorId: vendors.farms.id, lines: [line] }),
      GrnSchema,
    );
    grn = await ok(
      admin('PATCH', `/grns/${grn.id}`, {
        version: grn.version,
        vendorInvoiceNo: 'FF/1200',
        lines: [
          { ...line, quantityMilli: 12_000 },
          {
            inventoryItemId: items.eggs.id,
            unitId: 'unit-dozen',
            quantityMilli: 2_000,
            unitPrice: 8_000,
          },
        ],
      }),
      GrnSchema,
    );
    expect(grn).toMatchObject({ vendorInvoiceNo: 'FF/1200', subtotal: 118_000, version: 2 });
    expect(grn.lines).toHaveLength(2);
    grn = await ok(
      admin('POST', `/grns/${grn.id}/cancel`, { version: grn.version, reason: 'Entered twice' }),
      GrnSchema,
    );
    expect(grn).toMatchObject({ status: 'CANCELLED', cancelReason: 'Entered twice', balance: 0 });
    expect(
      (await admin('POST', `/grns/${grn.id}/post`, { version: grn.version })).json().code,
    ).toBe('INVALID_STATE_TRANSITION');
  });

  it('pays vendors against bills or on account, and shows statements and dues by age', async () => {
    const { admin, ok, items, vendors, s } = await purchasing();
    const accountant = await signInAs(s, admin, 'ACCOUNTANT', 'roy');
    const cashier = await signInAs(s, admin, 'CASHIER', 'meera');
    const bill = async (kg: number) => {
      const grn = await ok(
        admin('POST', '/grns', {
          vendorId: vendors.farms.id,
          lines: [
            {
              inventoryItemId: items.rice.id,
              unitId: 'unit-kg',
              quantityMilli: kg * 1_000,
              unitPrice: 9_000,
              taxRateBp: 500,
            },
          ],
        }),
        GrnSchema,
      );
      return ok(admin('POST', `/grns/${grn.id}/post`, { version: grn.version }), GrnSchema);
    };
    const first = await bill(20); // ₹1,890
    const second = await bill(5); // ₹472.50

    const pay = (call: typeof admin, body: object) => call('POST', '/vendor-payments', body);
    expect(
      (await pay(cashier, { vendorId: vendors.farms.id, method: 'CASH', amount: 100 })).statusCode,
    ).toBe(403);
    const paid = VendorPaymentSchema.parse(
      (
        await pay(accountant, {
          vendorId: vendors.farms.id,
          grnId: first.id,
          method: 'BANK',
          amount: 100_000,
          reference: 'UTR123',
        })
      ).json(),
    );
    expect(paid).toMatchObject({ grnNo: first.grnNo, paidOn: '2026-10-28', createdByName: 'roy' });
    const over = await pay(accountant, {
      vendorId: vendors.farms.id,
      grnId: second.id,
      method: 'UPI',
      amount: 47_251,
    });
    expect([over.statusCode, over.json().code]).toEqual([409, 'OVERPAYMENT']);
    const future = await pay(accountant, {
      vendorId: vendors.farms.id,
      method: 'CASH',
      amount: 100,
      paidOn: '2026-10-29',
    });
    expect(future.json().code).toBe('VALIDATION_FAILED');
    await ok(
      pay(accountant, { vendorId: vendors.farms.id, method: 'CASH', amount: 50_000 }),
      VendorPaymentSchema,
    );
    expect(trail(s, paid.id)).toEqual({
      audit: ['purchase.vendor_payment.create'],
      events: ['VendorPaymentRecorded'],
      queued: 1,
    });

    // ₹1,890 + ₹472.50 − ₹1,000 − ₹500 = ₹862.50
    expect((await ok(admin('GET', `/vendors/${vendors.farms.id}`), VendorSchema)).due).toBe(86_250);
    expect((await ok(admin('GET', `/grns/${first.id}`), GrnSchema)).balance).toBe(89_000);

    const statement = await ok(
      accountant('GET', `/vendors/${vendors.farms.id}/statement?from=2026-10-01&to=2026-10-31`),
      VendorStatementSchema,
    );
    expect(statement.openingBalance).toBe(0);
    expect(statement.entries.map((e) => [e.kind, e.credit, e.debit, e.balance])).toEqual([
      ['BILL', 189_000, 0, 189_000],
      ['BILL', 47_250, 0, 236_250],
      ['PAYMENT', 0, 100_000, 136_250],
      ['PAYMENT', 0, 50_000, 86_250],
    ]);
    expect(statement.entries[2]!.description).toBe(`BANK against ${first.grnNo}`);
    expect(statement.closingBalance).toBe(86_250);

    // Both bills fall due on 12 November (15 days' terms).
    const now = await ok(accountant('GET', '/reports/vendor-dues'), VendorDuesReportSchema);
    expect(now.rows).toEqual([
      expect.objectContaining({
        code: 'FRESH',
        billed: 236_250,
        paid: 150_000,
        due: 86_250,
        current: 86_250,
        oldestDueOn: '2026-11-12',
      }),
    ]);
    const later = await ok(
      accountant('GET', '/reports/vendor-dues?asOf=2026-12-20'),
      VendorDuesReportSchema,
    );
    expect(later.rows[0]).toMatchObject({ current: 0, d31to60: 86_250 });
    expect(later.totals).toMatchObject({ due: 86_250, d31to60: 86_250 });
  });
});
