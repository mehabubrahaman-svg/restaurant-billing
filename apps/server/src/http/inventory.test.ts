import {
  ConsumptionReportSchema,
  InventoryItemSchema,
  InventoryItemsResponseSchema,
  InventoryValuationSchema,
  OrderSchema,
  RecipeSchema,
  RecipesResponseSchema,
  ReportScheduleSchema,
  StockAlertsSchema,
  StockCountSchema,
  StockEntryResponseSchema,
  StockMovementsResponseSchema,
  TrialBalanceSchema,
  type InventoryItem,
  type InventoryValuation,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { caller, signInAs, trail, type Call } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

const KG = 1_000_000;
const G = 1_000;
const DAY = 24 * 60 * 60_000;

/**
 * The restaurant fixture plus a store room: rice, chicken (perishable, two
 * days' shelf life), curd, flour and butter, with opening stock and one
 * purchase, and recipes for the biryani (Full, and the dish for other sizes),
 * the naan and the Raita add-on.
 */
async function storeRoom() {
  const r = await restaurantServer();
  s = r.s;
  const { admin, ok } = r;
  const create = (body: object) => ok(admin('POST', '/inventory-items', body), InventoryItemSchema);
  const rice = await create({
    sku: 'RICE-BAS',
    name: 'Basmati rice',
    nameTranslations: { bn: 'বাসমতি চাল' },
    category: 'Grains',
    baseUnit: 'g',
    purchaseUnitId: 'unit-kg',
    maxLevelMilli: 25 * KG,
  });
  const chicken = await create({
    sku: 'CHK',
    name: 'Chicken',
    category: 'Meat',
    baseUnit: 'g',
    isPerishable: true,
    shelfLifeDays: 2,
  });
  const curd = await create({ sku: 'CURD', name: 'Curd', baseUnit: 'g', reorderLevelMilli: KG });
  const flour = await create({ sku: 'MAIDA', name: 'Flour', baseUnit: 'g' });
  const butter = await create({
    sku: 'BUTTER',
    name: 'Butter',
    baseUnit: 'g',
    reorderLevelMilli: 2 * KG,
  });

  await ok(
    admin('POST', '/stock/opening', {
      lines: [
        { inventoryItemId: rice.id, qtyMilli: 20 * KG, totalCost: 160_000 },
        { inventoryItemId: chicken.id, qtyMilli: 10 * KG, totalCost: 240_000 },
        { inventoryItemId: flour.id, qtyMilli: 10 * KG, totalCost: 40_000 },
        { inventoryItemId: butter.id, qtyMilli: KG, totalCost: 50_000 },
      ],
    }),
    StockEntryResponseSchema,
  );
  const receipt = await ok(
    admin('POST', '/stock/receipts', {
      reference: 'Bill 4471',
      lines: [
        { inventoryItemId: rice.id, qtyMilli: 10 * KG, totalCost: 100_000 },
        {
          inventoryItemId: chicken.id,
          qtyMilli: 5 * KG,
          totalCost: 125_000,
          batchNo: 'LOT-7',
          expiresOn: '2026-11-05',
        },
      ],
    }),
    StockEntryResponseSchema,
  );

  const recipe = (body: object) => ok(admin('POST', '/recipes', body), RecipeSchema);
  const fullRecipe = await recipe({
    menuItemId: r.menu.biryani.id,
    variantId: r.menu.full.id,
    ingredients: [
      { inventoryItemId: rice.id, qtyMilli: 250 * G },
      { inventoryItemId: chicken.id, qtyMilli: 200 * G, wastageBp: 1_000 },
    ],
  });
  // Any other size (Half) falls back to the dish's own recipe.
  await recipe({
    menuItemId: r.menu.biryani.id,
    ingredients: [
      { inventoryItemId: rice.id, qtyMilli: 150 * G },
      { inventoryItemId: chicken.id, qtyMilli: 120 * G },
    ],
  });
  // A batch of 10 naan: 1 kg flour, 100 g butter.
  await recipe({
    menuItemId: r.menu.naan.id,
    yieldPortions: 10,
    ingredients: [
      { inventoryItemId: flour.id, qtyMilli: KG },
      { inventoryItemId: butter.id, qtyMilli: 100 * G },
    ],
  });
  await admin('PUT', `/addons/${r.menu.raita.id}/ingredients`, {
    ingredients: [{ inventoryItemId: curd.id, qtyMilli: 50 * G }],
  });

  const stock = async (item: { id: string }) =>
    ok(admin('GET', `/inventory-items/${item.id}`), InventoryItemSchema);
  const movements = async (item: { id: string }) =>
    ok(
      admin('GET', `/stock/movements?inventoryItemId=${item.id}`),
      StockMovementsResponseSchema,
    ).then((p) => p.data);
  return {
    ...r,
    items: { rice, chicken, curd, flour, butter },
    receipt,
    fullRecipe,
    stock,
    movements,
  };
}

/** Opens an order at a table, adds the items and fires them. */
async function fire(
  r: Awaited<ReturnType<typeof storeRoom>>,
  call: Call,
  tableId: string,
  items: object[],
) {
  const order = await r.openAt(call, tableId);
  await r.ok(call('POST', `/orders/${order.id}/items`, { items }), OrderSchema);
  await call('POST', `/orders/${order.id}/kots`);
  return r.order(call, order.id);
}

describe('inventory', () => {
  it('keeps items with their unit, levels, stock value and average cost', async () => {
    const { admin, items, stock, receipt, s } = await storeRoom();

    // 20 kg at ₹80 + 10 kg at ₹100 = 30 kg at ₹86.67 a kg
    const rice = await stock(items.rice);
    expect(rice).toMatchObject({
      qtyMilli: 30 * KG,
      avgCostPerBase: 8_667,
      value: 260_010,
      level: 'OVER',
      nameTranslations: { bn: 'বাসমতি চাল' },
    });
    expect(await stock(items.curd)).toMatchObject({ qtyMilli: 0, level: 'OUT' });

    const list = InventoryItemsResponseSchema.parse(
      (await admin('GET', '/inventory-items')).json(),
    );
    expect(list.data.map((i) => i.sku)).toEqual(['RICE-BAS', 'CHK', 'BUTTER', 'CURD', 'MAIDA']);

    const dup = await admin('POST', '/inventory-items', {
      sku: 'rice-bas',
      name: 'x',
      baseUnit: 'g',
    });
    expect([dup.statusCode, dup.json().code]).toEqual([409, 'SKU_TAKEN']);
    const wrongUnit = await admin('POST', '/inventory-items', {
      sku: 'EGG',
      name: 'Eggs',
      baseUnit: 'pc',
      purchaseUnitId: 'unit-kg',
    });
    expect([wrongUnit.statusCode, wrongUnit.json().code]).toEqual([422, 'UNIT_MISMATCH']);

    // Levels are per branch; the base unit is fixed once stock has moved.
    const updated = InventoryItemSchema.parse(
      (
        await admin('PATCH', `/inventory-items/${rice.id}`, {
          version: rice.version,
          maxLevelMilli: 40 * KG,
          reorderLevelMilli: 5 * KG,
        })
      ).json(),
    );
    expect(updated).toMatchObject({
      level: 'OK',
      reorderLevelMilli: 5 * KG,
      version: rice.version + 1,
    });
    const unit = await admin('PATCH', `/inventory-items/${rice.id}`, {
      version: updated.version,
      baseUnit: 'ml',
    });
    expect(unit.json().code).toBe('VALIDATION_FAILED');
    // An ingredient can't be retired while a recipe uses it.
    const retire = await admin('PATCH', `/inventory-items/${rice.id}`, {
      version: updated.version,
      isActive: false,
    });
    expect(retire.statusCode).toBe(409);
    expect(retire.json().code).toBe('INGREDIENT_IN_USE');

    // Opening stock is entered once per item.
    const again = await admin('POST', '/stock/opening', {
      lines: [{ inventoryItemId: rice.id, qtyMilli: KG, totalCost: 8_000 }],
    });
    expect([again.statusCode, again.json().code]).toEqual([409, 'STOCK_ALREADY_MOVED']);

    expect(trail(s, receipt.referenceId)).toEqual({
      audit: ['inventory.stock.receive'],
      events: ['StockReceived'],
      queued: 1,
    });
  });

  it('costs a recipe per portion and as a share of the menu price', async () => {
    const { admin, fullRecipe, menu } = await storeRoom();
    // 250 g rice at ₹86.67/kg = ₹21.67; 200 g chicken + 10% trim at ₹243.33/kg = ₹53.53
    expect(fullRecipe).toMatchObject({
      menuItemName: 'Chicken Biryani',
      variantName: 'Full',
      costPerPortion: 7_520,
      sellingPrice: 32_000,
      foodCostBp: 2_350,
    });
    expect(fullRecipe.ingredients.map((i) => [i.name, i.costPerPortion])).toEqual([
      ['Basmati rice', 2_167],
      ['Chicken', 5_353],
    ]);
    const dup = await admin('POST', '/recipes', {
      menuItemId: menu.biryani.id,
      variantId: menu.full.id,
      ingredients: [{ inventoryItemId: fullRecipe.ingredients[0]!.inventoryItemId, qtyMilli: 1 }],
    });
    expect([dup.statusCode, dup.json().code]).toEqual([409, 'RECIPE_EXISTS']);

    const forDish = RecipesResponseSchema.parse(
      (await admin('GET', `/recipes?menuItemId=${menu.biryani.id}`)).json(),
    );
    expect(forDish.data.map((r) => r.variantName)).toEqual([null, 'Full']);

    // Removing a recipe: the dish no longer takes stock.
    const naan = RecipesResponseSchema.parse(
      (await admin('GET', `/recipes?menuItemId=${menu.naan.id}`)).json(),
    ).data[0]!;
    const removed = await admin('PATCH', `/recipes/${naan.id}`, {
      version: naan.version,
      isActive: false,
    });
    expect(removed.statusCode).toBe(204);
    expect((await admin('GET', `/recipes?menuItemId=${menu.naan.id}`)).json().data).toEqual([]);
  });

  it('takes ingredients from stock when a KOT is fired, earliest expiry first', async () => {
    const r = await storeRoom();
    const { admin, items, menu, tables, stock, movements } = r;
    const order = await fire(r, admin, tables.t1.id, [
      {
        menuItemId: menu.biryani.id,
        variantId: menu.full.id,
        quantity: 2,
        addons: [{ addonId: menu.raita.id }],
      },
      { menuItemId: menu.naan.id, quantity: 4 },
    ]);

    // 2 × (250 g rice, 220 g chicken) + 2 × 50 g curd; 4 naan = 400 g flour, 40 g butter
    expect((await stock(items.rice)).qtyMilli).toBe(30 * KG - 500 * G);
    expect((await stock(items.chicken)).qtyMilli).toBe(15 * KG - 440 * G);
    expect((await stock(items.flour)).qtyMilli).toBe(10 * KG - 400 * G);
    expect((await stock(items.butter)).qtyMilli).toBe(KG - 40 * G);
    // Nothing on the shelf: the sale goes through and stock goes negative.
    expect((await stock(items.curd)).qtyMilli).toBe(-100 * G);

    const chicken = await movements(items.chicken);
    expect(chicken[0]).toMatchObject({
      type: 'SALE_CONSUMPTION',
      qtyMilli: -440 * G,
      referenceType: 'ORDER_ITEM',
      referenceId: order.items[0]!.id,
      unitCostPerBase: 24_333,
      // The opening batch expires on the 30th, before LOT-7.
      batchNo: null,
    });
    expect(chicken.map((m) => m.type)).toEqual(['SALE_CONSUMPTION', 'PURCHASE', 'OPENING']);

    // Firing more of the same order consumes only the new items.
    await admin('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    await admin('POST', `/orders/${order.id}/kots`);
    expect((await stock(items.flour)).qtyMilli).toBe(10 * KG - 500 * G);

    // Each event is applied once, also when the projector catches up again (as at start-up).
    expect(r.s.container.cradle.inventoryProjector.catchUp()).toBe(0);
    expect((await stock(items.flour)).qtyMilli).toBe(10 * KG - 500 * G);
    const checkpoint = r.s.database.db
      .prepare<[], number>("SELECT last_seq FROM projection_checkpoints WHERE name = 'inventory'")
      .pluck()
      .get();
    const head = r.s.database.db
      .prepare<[], number>('SELECT max(seq) FROM domain_events')
      .pluck()
      .get();
    expect(checkpoint).toBe(head);
  });

  it('puts a cancelled dish back, or books it as wastage when it was thrown away', async () => {
    const r = await storeRoom();
    const { admin, items, menu, tables, stock, movements } = r;
    const a = await fire(r, admin, tables.t1.id, [{ menuItemId: menu.naan.id, quantity: 4 }]);
    const naan = a.items[0]!;
    await r.ok(
      admin('POST', `/orders/${a.id}/items/${naan.id}/cancel`, {
        version: naan.version,
        reason: 'Guest changed their mind',
      }),
      OrderSchema,
    );
    expect((await stock(items.flour)).qtyMilli).toBe(10 * KG);
    expect((await movements(items.flour)).map((m) => [m.type, m.qtyMilli])).toEqual([
      ['SALE_REVERSAL', 400 * G],
      ['SALE_CONSUMPTION', -400 * G],
      ['OPENING', 10 * KG],
    ]);

    // Half has no recipe of its own: the dish's (150 g rice, 120 g chicken) is used.
    const b = await fire(r, admin, tables.t2.id, [
      { menuItemId: menu.biryani.id, variantId: menu.half.id, quantity: 1 },
    ]);
    const half = b.items[0]!;
    await r.ok(
      admin('POST', `/orders/${b.id}/items/${half.id}/cancel`, {
        version: half.version,
        reason: 'Dropped on the floor',
        isWastage: true,
      }),
      OrderSchema,
    );
    expect((await stock(items.rice)).qtyMilli).toBe(30 * KG - 150 * G);
    expect(
      (await movements(items.rice)).slice(0, 3).map((m) => [m.type, m.qtyMilli, m.reason]),
    ).toEqual([
      ['WASTAGE', -150 * G, 'Dropped on the floor'],
      ['SALE_REVERSAL', 150 * G, 'Dropped on the floor'],
      ['SALE_CONSUMPTION', -150 * G, null],
    ]);
  });

  it('counts stock, books the differences and reports consumption against recipes', async () => {
    const r = await storeRoom();
    const { admin, items, menu, tables, ok } = r;
    await fire(r, admin, tables.t1.id, [
      { menuItemId: menu.biryani.id, variantId: menu.full.id, quantity: 2 },
    ]);
    // Spoiled rice, and a pack of butter that wasn't on the books.
    await ok(
      admin('POST', '/stock/wastage', {
        reason: 'Rats got into the sack',
        lines: [{ inventoryItemId: items.rice.id, qtyMilli: KG }],
      }),
      StockEntryResponseSchema,
    );
    const adjusted = await ok(
      admin('POST', '/stock/adjustments', {
        reason: 'Found a pack in the cold room',
        lines: [{ inventoryItemId: items.butter.id, qtyMilli: 200 * G }],
      }),
      StockEntryResponseSchema,
    );
    expect(adjusted.items[0]).toMatchObject({ qtyMilli: 1_200 * G, level: 'LOW' });

    let count = await ok(
      admin('POST', '/stock-counts', { countType: 'CLOSING' }),
      StockCountSchema,
    );
    expect(count).toMatchObject({ status: 'DRAFT', businessDate: '2026-10-28', counted: 0 });
    expect(count.lines).toHaveLength(5);
    count = await ok(
      admin('PUT', `/stock-counts/${count.id}/lines`, {
        version: count.version,
        lines: [
          // Books: 30 kg − 500 g sold − 1 kg wasted = 28.5 kg; the shelf has 28 kg.
          { inventoryItemId: items.rice.id, countedQtyMilli: 28 * KG },
          { inventoryItemId: items.flour.id, countedQtyMilli: 10 * KG },
        ],
      }),
      StockCountSchema,
    );
    const riceLine = count.lines.find((l) => l.inventoryItemId === items.rice.id)!;
    expect(riceLine).toMatchObject({
      systemQtyMilli: 28_500 * G,
      countedQtyMilli: 28 * KG,
      varianceMilli: -500 * G,
    });
    count = await ok(
      admin('POST', `/stock-counts/${count.id}/post`, { version: count.version }),
      StockCountSchema,
    );
    expect(count).toMatchObject({ status: 'POSTED', counted: 2, postedByName: 'Ananya Sen' });
    expect(count.lines.map((l) => l.varianceMilli)).toEqual([-500 * G, 0]);
    expect((await r.stock(items.rice)).qtyMilli).toBe(28 * KG);
    const again = await admin('POST', `/stock-counts/${count.id}/post`, { version: count.version });
    expect(again.json().code).toBe('INVALID_STATE_TRANSITION');

    const report = ConsumptionReportSchema.parse(
      (await admin('GET', '/reports/consumption?from=2026-10-28&to=2026-10-28')).json(),
    );
    expect(report.rows.find((row) => row.sku === 'RICE-BAS')).toMatchObject({
      openingMilli: 0,
      receivedMilli: 30 * KG,
      soldMilli: 500 * G,
      wastageMilli: KG,
      adjustedMilli: 0,
      countVarianceMilli: -500 * G,
      closingMilli: 28 * KG,
      // 500 g more than the recipes say, on 500 g sold
      varianceBp: 10_000,
    });
    expect(report.rows.find((row) => row.sku === 'BUTTER')).toMatchObject({
      adjustedMilli: 200 * G,
      closingMilli: 1_200 * G,
    });
    // The next day opens with yesterday's closing.
    const next = ConsumptionReportSchema.parse(
      (await admin('GET', '/reports/consumption?from=2026-10-29&to=2026-10-29')).json(),
    );
    expect(next.rows.find((row) => row.sku === 'RICE-BAS')).toMatchObject({
      openingMilli: 28 * KG,
      soldMilli: 0,
      closingMilli: 28 * KG,
      varianceBp: null,
    });
  });

  it('keeps the sales made after an item was counted when the count is posted', async () => {
    const r = await storeRoom();
    const { admin, items, menu, tables, ok } = r;
    let count = await ok(admin('POST', '/stock-counts', {}), StockCountSchema);
    // The shelf has 29 kg against 30 kg on the books when it is counted…
    count = await ok(
      admin('PUT', `/stock-counts/${count.id}/lines`, {
        version: count.version,
        lines: [{ inventoryItemId: items.rice.id, countedQtyMilli: 29 * KG }],
      }),
      StockCountSchema,
    );
    // …then two biryanis take 500 g before the count is posted.
    await fire(r, admin, tables.t1.id, [
      { menuItemId: menu.biryani.id, variantId: menu.full.id, quantity: 2 },
    ]);
    count = await ok(
      admin('POST', `/stock-counts/${count.id}/post`, { version: count.version }),
      StockCountSchema,
    );
    expect(count.lines[0]).toMatchObject({ systemQtyMilli: 30 * KG, varianceMilli: -KG });
    expect((await r.stock(items.rice)).qtyMilli).toBe(28_500 * G);
  });

  it('takes opening stock for an item that sold before it was entered', async () => {
    const r = await storeRoom();
    const { admin, items, menu, tables, ok } = r;
    await fire(r, admin, tables.t1.id, [
      {
        menuItemId: menu.biryani.id,
        variantId: menu.full.id,
        quantity: 1,
        addons: [{ addonId: menu.raita.id }],
      },
    ]);
    expect((await r.stock(items.curd)).qtyMilli).toBe(-50 * G);
    await ok(
      admin('POST', '/stock/opening', {
        lines: [
          {
            inventoryItemId: items.curd.id,
            qtyMilli: 2 * KG,
            totalCost: 10_000,
            expiresOn: '2026-10-30',
          },
        ],
      }),
      StockEntryResponseSchema,
    );
    // ₹50/kg; the 50 g already sold came out of this stock, so its batch holds 1.95 kg.
    expect(await r.stock(items.curd)).toMatchObject({ qtyMilli: 1_950 * G, avgCostPerBase: 5_000 });
    const alerts = await ok(admin('GET', '/stock/alerts'), StockAlertsSchema);
    expect(alerts.expiring.find((b) => b.inventoryItemId === items.curd.id)).toMatchObject({
      remainingMilli: 1_950 * G,
    });
    const again = await admin('POST', '/stock/opening', {
      lines: [{ inventoryItemId: items.curd.id, qtyMilli: KG, totalCost: 5_000 }],
    });
    expect(again.json().code).toBe('STOCK_ALREADY_MOVED');
  });

  it('alerts on low, out, over and negative stock and on batches about to expire', async () => {
    const r = await storeRoom();
    const { admin, items, menu, tables, ok } = r;
    await fire(r, admin, tables.t1.id, [
      {
        menuItemId: menu.biryani.id,
        variantId: menu.full.id,
        quantity: 1,
        addons: [{ addonId: menu.raita.id }],
      },
    ]);
    const alerts = await ok(admin('GET', '/stock/alerts'), StockAlertsSchema);
    expect(alerts.levels.map((l) => [l.name, l.level])).toEqual([
      ['Basmati rice', 'OVER'],
      ['Butter', 'LOW'],
      ['Curd', 'OUT'],
    ]);
    expect(alerts.negative).toEqual([expect.objectContaining({ name: 'Curd', qtyMilli: -50 * G })]);
    // The opening chicken took the 2-day shelf life: it expires on the 30th, LOT-7 on 5 November.
    expect(alerts.expiring).toEqual([
      expect.objectContaining({
        inventoryItemId: items.chicken.id,
        expiresOn: '2026-10-30',
        remainingMilli: 10 * KG - 220 * G,
        expired: false,
      }),
    ]);
  });

  it('values stock on any day at that day’s average cost, against the books', async () => {
    const r = await storeRoom();
    const { admin, items, menu, tables, ok } = r;
    // 28 October: a biryani with raita (curd goes 50 g below zero), and 1 kg of rice spoiled.
    await fire(r, admin, tables.t1.id, [
      {
        menuItemId: menu.biryani.id,
        variantId: menu.full.id,
        quantity: 1,
        addons: [{ addonId: menu.raita.id }],
      },
    ]);
    await ok(
      admin('POST', '/stock/wastage', {
        reason: 'Rats got into the sack',
        lines: [{ inventoryItemId: items.rice.id, qtyMilli: KG }],
      }),
      StockEntryResponseSchema,
    );
    // 29 October (signed in again): rice at ₹120 a kg, and the first curd at ₹200.
    r.s.clock.advance(DAY);
    const owner = caller(r.s, (await r.s.login()).accessToken);
    const valuation = async (from: string, to: string) =>
      ok(
        owner('GET', `/reports/inventory-valuation?from=${from}&to=${to}`),
        InventoryValuationSchema,
      );
    await ok(
      owner('POST', '/stock/receipts', {
        lines: [
          { inventoryItemId: items.rice.id, qtyMilli: 10 * KG, totalCost: 120_000 },
          { inventoryItemId: items.curd.id, qtyMilli: KG, totalCost: 20_000 },
        ],
      }),
      StockEntryResponseSchema,
    );

    // The 28th, read on the 29th, is still at the 28th's ₹86.67.
    const first = await valuation('2026-10-28', '2026-10-28');
    const row = (v: InventoryValuation, sku: string) => v.rows.find((x) => x.sku === sku)!;
    expect(row(first, 'RICE-BAS')).toMatchObject({
      openingMilli: 0,
      openingValue: 0,
      receivedMilli: 30 * KG,
      receivedValue: 260_000,
      soldMilli: 250 * G,
      soldValue: 2_167,
      wastageMilli: KG,
      wastageValue: 8_667,
      adjustedMilli: 0,
      closingMilli: 28_750 * G,
      closingCostPerBase: 8_667,
      closingValue: 249_176,
      // 30 kg at ₹86.67 is 10 paise more than was paid
      differenceValue: 10,
    });
    // Below zero is valued at nil.
    expect(row(first, 'CURD')).toMatchObject({ closingMilli: -50 * G, closingValue: 0 });

    // The 29th opens at the 28th's closing; the new rice moves the average to ₹95.27.
    const second = await valuation('2026-10-29', '2026-10-29');
    expect(row(second, 'RICE-BAS')).toMatchObject({
      openingMilli: 28_750 * G,
      openingCostPerBase: 8_667,
      openingValue: 249_176,
      receivedValue: 120_000,
      closingMilli: 38_750 * G,
      closingCostPerBase: 9_527,
      closingValue: 369_171,
      differenceValue: -5,
    });
    // The 50 g sold before any curd came in went out at nil: ₹10 left as a difference.
    expect(row(second, 'CURD')).toMatchObject({
      openingValue: 0,
      receivedValue: 20_000,
      closingMilli: 950 * G,
      closingCostPerBase: 20_000,
      closingValue: 19_000,
      differenceValue: -1_000,
    });
    // Today's closing is what the items list says.
    const list = InventoryItemsResponseSchema.parse(
      (await owner('GET', '/inventory-items')).json(),
    ).data;
    expect(
      second.rows.map((x) => [x.sku, x.closingMilli, x.closingCostPerBase, x.closingValue]),
    ).toEqual(
      expect.arrayContaining(list.map((i) => [i.sku, i.qtyMilli, i.avgCostPerBase, i.value])),
    );
    expect(second.rows).toHaveLength(list.length);
    expect(second.totals.closingValue).toBe(list.reduce((s, i) => s + i.value, 0));
    expect(second.categories.map((c) => [c.category, c.items])).toEqual([
      ['Grains', 1],
      ['Meat', 1],
      [null, 3],
    ]);

    // Both days at once roll forward from nothing to today.
    const both = await valuation('2026-10-28', '2026-10-29');
    const t = both.totals;
    expect(t.closingValue).toBe(second.totals.closingValue);
    expect(t.openingValue).toBe(0);
    expect(
      t.openingValue +
        t.receivedValue -
        t.soldValue -
        t.wastageValue +
        t.adjustedValue +
        t.differenceValue,
    ).toBe(t.closingValue);

    // The books hold stock on Inventory (1200): the same as the trial balance.
    const tb = await ok(owner('GET', '/reports/trial-balance?asOf=2026-10-29'), TrialBalanceSchema);
    const books = tb.rows.find((a) => a.code === '1200')!;
    expect(second.books).toEqual({
      inventoryAccount: books.debit - books.credit,
      difference: second.totals.closingValue - (books.debit - books.credit),
    });

    const xlsx = await owner(
      'GET',
      '/reports/inventory-valuation.xlsx?from=2026-10-28&to=2026-10-29',
    );
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-disposition']).toContain(
      'stock-value-2026-10-28-to-2026-10-29.xlsx',
    );
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const csv = await owner(
      'GET',
      '/reports/inventory-valuation.csv?from=2026-10-29&to=2026-10-29',
    );
    const rupees = (paise: number) => (paise / 100).toFixed(2);
    expect(csv.body).toContain(`Closing stock (2026-10-29),${rupees(second.totals.closingValue)}`);
    expect(csv.body).toContain(`Closing stock less the books,${rupees(second.books.difference)}`);
    expect(csv.body).toContain('RICE-BAS,Basmati rice,Grains,kg,28.750,2491.76,10.000,1200.00');

    // Scheduled: the day before as a file, once the day has ended.
    await ok(
      owner('POST', '/report-schedules', {
        report: 'INVENTORY_VALUATION',
        frequency: 'DAILY',
        format: 'CSV',
      }),
      ReportScheduleSchema,
    );
    const made = r.s.container.cradle.reportScheduleService.runDue();
    expect(made.failed).toEqual([]);
    expect(made.made.map((f) => f.fileName)).toEqual(['stock-value-2026-10-28.csv']);
    const file = await owner('GET', `/report-files/${made.made[0]!.id}/download`);
    expect(file.body).toContain(`Closing stock (2026-10-28),${rupees(first.totals.closingValue)}`);

    // Stock staff read it but don't export it; cashiers don't see it.
    const store = await signInAs(r.s, owner, 'INVENTORY', 'gopal');
    const cashier = await signInAs(r.s, owner, 'CASHIER', 'meera');
    expect(
      (await store('GET', '/reports/inventory-valuation?from=2026-10-01&to=2026-10-29')).statusCode,
    ).toBe(200);
    expect(
      (await store('GET', '/reports/inventory-valuation.xlsx?from=2026-10-01&to=2026-10-29'))
        .statusCode,
    ).toBe(403);
    expect(
      (await cashier('GET', '/reports/inventory-valuation?from=2026-10-01&to=2026-10-29'))
        .statusCode,
    ).toBe(403);
    const tooLong = await owner(
      'GET',
      '/reports/inventory-valuation?from=2025-01-01&to=2026-10-29',
    );
    expect(tooLong.json().code).toBe('VALIDATION_FAILED');
  });

  it('checks permissions: stock staff run the store room, cashiers don’t see it', async () => {
    const r = await storeRoom();
    const store = await signInAs(r.s, r.admin, 'INVENTORY', 'gopal');
    const cashier = await signInAs(r.s, r.admin, 'CASHIER', 'meera');

    expect((await cashier('GET', '/inventory-items')).statusCode).toBe(403);
    expect((await cashier('POST', '/stock/wastage', {})).statusCode).toBe(403);

    const item: InventoryItem = InventoryItemSchema.parse(
      (
        await store('POST', '/inventory-items', { sku: 'ONION', name: 'Onion', baseUnit: 'g' })
      ).json(),
    );
    const received = await store('POST', '/stock/receipts', {
      lines: [{ inventoryItemId: item.id, qtyMilli: 5 * KG, totalCost: 15_000 }],
    });
    expect(received.statusCode).toBe(201);
    expect(
      (await store('GET', '/reports/consumption?from=2026-10-01&to=2026-10-28')).statusCode,
    ).toBe(200);
    const tooLong = await store('GET', '/reports/consumption?from=2025-01-01&to=2026-10-28');
    expect(tooLong.json().code).toBe('VALIDATION_FAILED');
    // The menu editor reads recipes; it doesn't change stock.
    expect((await r.admin('GET', `/recipes?menuItemId=${r.menu.naan.id}`)).statusCode).toBe(200);
    expect((await store('PATCH', `/menu-items/${r.menu.naan.id}`, { version: 1 })).statusCode).toBe(
      403,
    );
  });
});
