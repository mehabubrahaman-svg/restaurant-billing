import {
  AddonGroupSchema,
  CategorySchema,
  DiningTableSchema,
  FloorAreaSchema,
  KitchenStationSchema,
  MenuItemSchema,
  OrderSchema,
} from '@restroos/contracts';
import { caller, type Call } from './staff';
import { createTestServer, type TestServer } from './test-server';

/**
 * A small working restaurant: two kitchen stations, a biryani with sizes and
 * add-ons, naan from the tandoor, and three tables. Built through the API.
 */
export async function restaurantServer() {
  const s = await createTestServer();
  const admin = caller(s, (await s.login()).accessToken);
  const ok = async <T>(
    res: Promise<{ statusCode: number; json(): unknown; body: string }>,
    schema: { parse(v: unknown): T },
  ) => {
    const r = await res;
    if (r.statusCode >= 300) throw new Error(`${r.statusCode} ${r.body}`);
    return schema.parse(r.json());
  };
  const main = await ok(
    admin('POST', '/kitchen-stations', { name: 'Main Kitchen' }),
    KitchenStationSchema,
  );
  const tandoor = await ok(
    admin('POST', '/kitchen-stations', { name: 'Tandoor' }),
    KitchenStationSchema,
  );
  const category = await ok(admin('POST', '/categories', { name: 'Mains' }), CategorySchema);
  const sides = await ok(
    admin('POST', '/addon-groups', {
      name: 'Sides',
      maxSelect: 2,
      addons: [
        { name: 'Raita', price: 4000 },
        { name: 'Extra egg', price: 2500 },
      ],
    }),
    AddonGroupSchema,
  );
  const biryani = await ok(
    admin('POST', '/menu-items', {
      sku: 'BIR-CHK',
      name: 'Chicken Biryani',
      categoryId: category.id,
      foodType: 'NON_VEG',
      basePrice: 32000,
      kitchenStationId: main.id,
      prepTimeSec: 1200,
      variants: [
        { name: 'Half', price: 19000 },
        { name: 'Full', price: 32000 },
      ],
      addonGroupIds: [sides.id],
    }),
    MenuItemSchema,
  );
  const naan = await ok(
    admin('POST', '/menu-items', {
      sku: 'NAAN-BTR',
      name: 'Butter Naan',
      categoryId: category.id,
      foodType: 'VEG',
      basePrice: 6000,
      kitchenStationId: tandoor.id,
      prepTimeSec: 300,
    }),
    MenuItemSchema,
  );
  const area = await ok(admin('POST', '/floor-areas', { name: 'Ground floor' }), FloorAreaSchema);
  const tables = [];
  for (const label of ['T1', 'T2', 'T3']) {
    tables.push(
      await ok(admin('POST', '/tables', { floorAreaId: area.id, label }), DiningTableSchema),
    );
  }
  const [t1, t2, t3] = tables as [(typeof tables)[0], (typeof tables)[0], (typeof tables)[0]];
  const full = biryani.variants.find((v) => v.name === 'Full')!;
  const half = biryani.variants.find((v) => v.name === 'Half')!;
  const raita = sides.addons.find((a) => a.name === 'Raita')!;

  /** Opens a dine-in order at a table and returns it. */
  const openAt = (call: Call, tableId: string, covers = 2) =>
    ok(call('POST', '/orders', { orderType: 'DINE_IN', tableId, covers }), OrderSchema);
  const order = (call: Call, id: string) => ok(call('GET', `/orders/${id}`), OrderSchema);

  return {
    s: s as TestServer,
    admin,
    menu: { main, tandoor, category, sides, biryani, naan, full, half, raita },
    tables: { t1, t2, t3 },
    ok,
    openAt,
    order,
  };
}
