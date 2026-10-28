import {
  AddonGroupSchema,
  CategorySchema,
  KitchenStationSchema,
  MenuImportResponseSchema,
  MenuItemSchema,
  MenuSnapshotSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { caller, signInAs, trail, type Call } from '../testing/staff';
import { createTestServer, type TestServer } from '../testing/test-server';

let s: TestServer;
afterEach(async () => s?.close());

async function menuServer() {
  s = await createTestServer();
  const admin = caller(s, (await s.login()).accessToken);
  const taxGroup = (name: string) =>
    s.database.db
      .prepare<[string], string>('SELECT id FROM tax_groups WHERE name = ?')
      .pluck()
      .get(name)!;
  return { admin, taxGroup };
}

async function biryani(admin: Call, taxGroupId: string) {
  const station = KitchenStationSchema.parse(
    (await admin('POST', '/kitchen-stations', { name: 'Tandoor' })).json(),
  );
  const category = CategorySchema.parse(
    (
      await admin('POST', '/categories', {
        name: 'Biryani',
        nameTranslations: { hi: 'बिरयानी', bn: 'বিরিয়ানি' },
        color: '#C2410C',
      })
    ).json(),
  );
  const raita = AddonGroupSchema.parse(
    (
      await admin('POST', '/addon-groups', {
        name: 'Sides',
        maxSelect: 2,
        addons: [
          { name: 'Raita', price: 4000 },
          { name: 'Salan', price: 3000 },
        ],
      })
    ).json(),
  );
  const res = await admin('POST', '/menu-items', {
    sku: 'bir-chk',
    name: 'Chicken Biryani',
    nameTranslations: { bn: 'চিকেন বিরিয়ানি' },
    categoryId: category.id,
    foodType: 'NON_VEG',
    basePrice: 32000,
    taxGroupId,
    hsnSacCode: '996331',
    kitchenStationId: station.id,
    variants: [
      { name: 'Half', price: 22000 },
      { name: 'Full', price: 32000 },
    ],
    addonGroupIds: [raita.id],
  });
  expect(res.statusCode).toBe(201);
  return { station, category, raita, item: MenuItemSchema.parse(res.json()) };
}

describe('menu', () => {
  it('builds a menu with stations, categories, variants and add-ons, with an audit trail', async () => {
    const { admin, taxGroup } = await menuServer();
    const { item, raita } = await biryani(admin, taxGroup('GST 5%'));
    expect(item).toMatchObject({
      sku: 'BIR-CHK',
      isAvailable: true,
      addonGroupIds: [raita.id],
      variants: [
        { name: 'Half', price: 22000, sortOrder: 0 },
        { name: 'Full', price: 32000, sortOrder: 1 },
      ],
    });
    expect(trail(s, item.id)).toEqual({
      audit: ['menu.item.create'],
      events: ['MenuItemCreated'],
      queued: 1,
    });

    // Variants are a full list: keep "Full" (by id), drop "Half", add "Family".
    const full = item.variants.find((v) => v.name === 'Full')!;
    const edited = await admin('PATCH', `/menu-items/${item.id}`, {
      version: item.version,
      basePrice: 34000,
      variants: [
        { id: full.id, name: 'Full', price: 34000 },
        { name: 'Family pack', price: 89000 },
      ],
    });
    expect(edited.statusCode).toBe(200);
    const after = MenuItemSchema.parse(edited.json());
    expect(after.variants.map((v) => [v.name, v.price])).toEqual([
      ['Full', 34000],
      ['Family pack', 89000],
    ]);
    expect(after.variants[0]!.id).toBe(full.id);

    const stale = await admin('PATCH', `/menu-items/${item.id}`, {
      version: item.version,
      name: 'X',
    });
    expect(stale.statusCode).toBe(409);
  });

  it('rejects bad references and duplicate SKUs', async () => {
    const { admin, taxGroup } = await menuServer();
    const { category } = await biryani(admin, taxGroup('GST 5%'));
    const base = {
      name: 'Veg Biryani',
      categoryId: category.id,
      foodType: 'VEG',
      basePrice: 24000,
    };
    expect((await admin('POST', '/menu-items', { ...base, sku: 'BIR-CHK' })).json().code).toBe(
      'SKU_TAKEN',
    );
    expect(
      (
        await admin('POST', '/menu-items', {
          ...base,
          sku: 'BIR-VEG',
          taxGroupId: '01900000-0000-7000-8000-000000000000',
        })
      ).json().code,
    ).toBe('TAX_GROUP_NOT_FOUND');
    expect(
      (
        await admin('POST', '/addon-groups', {
          name: 'Bad',
          minSelect: 3,
          maxSelect: 1,
          addons: [{ name: 'A', price: 0 }],
        })
      ).json().code,
    ).toBe('ADDON_GROUP_INVALID');
    expect((await admin('POST', '/menu-items', { ...base, sku: 'has space' })).json().code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('will not retire a category that still has items', async () => {
    const { admin, taxGroup } = await menuServer();
    const { category } = await biryani(admin, taxGroup('GST 5%'));
    const res = await admin('PATCH', `/categories/${category.id}`, {
      version: category.version,
      isActive: false,
    });
    expect(res.json().code).toBe('CATEGORY_HAS_ITEMS');
  });

  it('serves a snapshot with an ETag that changes when the menu does', async () => {
    const { admin, taxGroup } = await menuServer();
    const { item } = await biryani(admin, taxGroup('GST 5%'));
    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');

    const first = await captain('GET', '/menu');
    expect(first.statusCode).toBe(200);
    const snapshot = MenuSnapshotSchema.parse(first.json());
    expect(snapshot.items.map((i) => i.sku)).toEqual(['BIR-CHK']);
    expect(first.headers['etag']).toBe(`"${snapshot.version}"`);

    const again = await captain('GET', '/menu', undefined, {
      'if-none-match': first.headers['etag'] as string,
    });
    expect(again.statusCode).toBe(304);

    await admin('POST', `/menu-items/${item.id}/availability`, { isAvailable: false });
    const changed = await captain('GET', '/menu', undefined, {
      'if-none-match': first.headers['etag'] as string,
    });
    expect(changed.statusCode).toBe(200);
    expect(MenuSnapshotSchema.parse(changed.json()).items[0]!.isAvailable).toBe(false);
  });

  it('lets the kitchen 86 an item but not edit the menu', async () => {
    const { admin, taxGroup } = await menuServer();
    const { item } = await biryani(admin, taxGroup('GST 5%'));
    const kitchen = await signInAs(s, admin, 'KITCHEN', 'chef.bose');

    const off = await kitchen('POST', `/menu-items/${item.id}/availability`, {
      isAvailable: false,
    });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ isAvailable: false, version: item.version });
    expect(trail(s, item.id).audit).toContain('menu.item.availability');

    const edit = await kitchen('PATCH', `/menu-items/${item.id}`, {
      version: item.version,
      basePrice: 1,
    });
    expect(edit.statusCode).toBe(403);
    expect((await kitchen('POST', '/categories', { name: 'Sneaky' })).statusCode).toBe(403);
  });
});

describe('menu CSV import', () => {
  const sheet = [
    'sku,name,category,price,food_type,tax_group,kitchen_station,name_bn',
    'PNR-TKA,Paneer Tikka,Starters,249.50,veg,GST 5%,Tandoor,পনির টিক্কা',
    'MTN-RJ,"Mutton Rogan Josh, bone-in",Mains,420,non-veg,GST 5%,Main Kitchen,',
  ].join('\n');

  it('previews without writing, then imports everything in one go', async () => {
    const { admin } = await menuServer();
    const preview = MenuImportResponseSchema.parse(
      (await admin('POST', '/menu/import', { csv: sheet, dryRun: true })).json(),
    );
    expect(preview).toMatchObject({
      dryRun: true,
      rows: 2,
      created: 2,
      updated: 0,
      errors: [],
      createdCategories: ['Starters', 'Mains'],
      createdStations: ['Tandoor', 'Main Kitchen'],
    });
    expect((await admin('GET', '/menu-items')).json().data).toEqual([]);

    const done = MenuImportResponseSchema.parse(
      (await admin('POST', '/menu/import', { csv: sheet, dryRun: false })).json(),
    );
    expect(done).toMatchObject({ dryRun: false, created: 2, errors: [] });
    const items = MenuItemSchema.array().parse((await admin('GET', '/menu-items')).json().data);
    const paneer = items.find((i) => i.sku === 'PNR-TKA')!;
    expect(paneer).toMatchObject({
      basePrice: 24950,
      foodType: 'VEG',
      nameTranslations: { bn: 'পনির টিক্কা' },
    });
    expect(items.find((i) => i.sku === 'MTN-RJ')!.name).toBe('Mutton Rogan Josh, bone-in');

    // Same sheet again with a new price: updates by SKU, creates nothing.
    const again = MenuImportResponseSchema.parse(
      (
        await admin('POST', '/menu/import', { csv: sheet.replace('249.50', '259'), dryRun: false })
      ).json(),
    );
    expect(again).toMatchObject({
      created: 0,
      updated: 2,
      createdCategories: [],
      createdStations: [],
    });
  });

  it('writes nothing when any row is wrong', async () => {
    const { admin } = await menuServer();
    const bad = `${sheet}\nBAD,Bad Item,Mains,12.345,veg,No Such Tax,,`;
    const res = MenuImportResponseSchema.parse(
      (await admin('POST', '/menu/import', { csv: bad, dryRun: false })).json(),
    );
    expect(res.errors.map((e) => [e.row, e.column])).toEqual([
      [4, 'price'],
      [4, 'tax_group'],
    ]);
    expect((await admin('GET', '/menu-items')).json().data).toEqual([]);
    expect((await admin('GET', '/categories')).json().data).toEqual([]);
  });
});
