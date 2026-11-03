import {
  AddonGroupSchema,
  CategorySchema,
  MenuImportResponseSchema,
  MenuItemSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { caller, signInAs, type Call } from '../testing/staff';
import { createTestServer, type TestServer } from '../testing/test-server';

let s: TestServer;
afterEach(async () => s?.close());

/** A PNG header of the given size (the Hub reads the header, it doesn't decode). `seed` varies the bytes. */
function png(width: number, height: number, seed = 0): Buffer {
  const b = Buffer.alloc(64 + seed);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b.fill(seed % 256, 33);
  return b;
}

/** A WebP (VP8X) header. */
function webp(width: number, height: number): Buffer {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

async function upload(call: Call, image: Buffer, thumbnail = webp(320, 320)) {
  return call('POST', '/media/images', {
    image: image.toString('base64'),
    thumbnail: thumbnail.toString('base64'),
  });
}

async function server() {
  s = await createTestServer();
  const admin = caller(s, (await s.login()).accessToken);
  return { admin };
}

describe('dish photos', () => {
  it('stores a photo once, serves it to anyone with long caching, and checks what it is', async () => {
    const { admin } = await server();
    const first = await upload(admin, png(1280, 960, 1));
    expect(first.statusCode).toBe(201);
    const photo = first.json() as { id: string; width: number; height: number };
    expect(photo).toMatchObject({ width: 1280, height: 960 });
    expect(photo.id).toMatch(/^[0-9a-f]{64}$/);
    // The same bytes again: the same asset.
    expect((await upload(admin, png(1280, 960, 1))).json().id).toBe(photo.id);

    // Guests on the QR menu aren't signed in.
    const full = await s.app.inject({ url: `/api/v1/media/${photo.id}` });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/png');
    expect(full.headers['cache-control']).toContain('immutable');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(full.rawPayload.equals(png(1280, 960, 1))).toBe(true);
    const thumb = await s.app.inject({ url: `/api/v1/media/${photo.id}/thumb` });
    expect(thumb.headers['content-type']).toBe('image/webp');
    const again = await s.app.inject({
      url: `/api/v1/media/${photo.id}`,
      headers: { 'if-none-match': full.headers.etag as string },
    });
    expect(again.statusCode).toBe(304);
    expect((await s.app.inject({ url: `/api/v1/media/${'0'.repeat(64)}` })).statusCode).toBe(404);
    expect((await s.app.inject({ url: '/api/v1/media/not-an-id' })).statusCode).toBe(422);

    // Not an image (an SVG or a script with an image name is still text).
    const svg = await upload(admin, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect([svg.statusCode, svg.json().code]).toEqual([422, 'IMAGE_INVALID']);
    const huge = await upload(admin, png(5000, 100));
    expect([huge.statusCode, huge.json().code]).toEqual([413, 'IMAGE_TOO_LARGE']);
    const bigThumb = await upload(admin, png(800, 600, 2), png(2000, 2000));
    expect(bigThumb.json().code).toBe('IMAGE_TOO_LARGE');

    // Uploading is for people who can edit the menu.
    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');
    expect((await upload(captain, png(100, 100, 3))).statusCode).toBe(403);
  });

  it('puts a photo on a dish and takes it off again', async () => {
    const { admin } = await server();
    const category = CategorySchema.parse(
      (await admin('POST', '/categories', { name: 'Starters' })).json(),
    );
    const photo = (await upload(admin, png(800, 600, 4))).json().id as string;
    const item = MenuItemSchema.parse(
      (
        await admin('POST', '/menu-items', {
          sku: 'PNR-TKA',
          name: 'Paneer Tikka',
          categoryId: category.id,
          foodType: 'VEG',
          basePrice: 24900,
          imageId: photo,
        })
      ).json(),
    );
    expect(item.imageId).toBe(photo);
    const missing = await admin('PATCH', `/menu-items/${item.id}`, {
      version: item.version,
      imageId: 'a'.repeat(64),
    });
    expect([missing.statusCode, missing.json().code]).toEqual([422, 'IMAGE_NOT_FOUND']);
    // A change that doesn't mention the photo keeps it.
    const renamed = MenuItemSchema.parse(
      (
        await admin('PATCH', `/menu-items/${item.id}`, {
          version: item.version,
          name: 'Paneer Tikka (6 pc)',
        })
      ).json(),
    );
    expect(renamed.imageId).toBe(photo);
    const cleared = MenuItemSchema.parse(
      (
        await admin('PATCH', `/menu-items/${item.id}`, { version: renamed.version, imageId: null })
      ).json(),
    );
    expect(cleared.imageId).toBeNull();
  });
});

describe('menu upload from a spreadsheet with photos', () => {
  const header = [
    'SKU',
    'Name',
    'Category',
    'Price',
    'Food Type',
    'Kitchen Station',
    'Variants',
    'Addon Groups',
    'Prep Time Min',
    'Description BN',
    'Image',
    'Active',
  ];

  it('previews every row with its photo, imports, then finds nothing to change', async () => {
    const { admin } = await server();
    const dips = await admin('POST', '/addon-groups', {
      name: 'Dips',
      maxSelect: 2,
      addons: [
        { name: 'Mint chutney', price: 2000 },
        { name: 'Tamarind', price: 2000 },
      ],
    });
    AddonGroupSchema.parse(dips.json());
    const tikka = (await upload(admin, png(800, 600, 10))).json().id as string;
    const biryani = (await upload(admin, png(800, 600, 11))).json().id as string;
    const spare = (await upload(admin, png(800, 600, 12))).json().id as string;
    const rows = [
      header,
      // The photo file is named after the SKU: matched without an image column value.
      [
        'PNR-TKA',
        'Paneer Tikka',
        'Starters',
        '249',
        'veg',
        'Tandoor',
        '',
        'Dips',
        '15',
        '',
        '',
        '',
      ],
      // Named in the image column, any case, with sizes.
      [
        'BIR-CHK',
        'Chicken Biryani',
        'Biryani',
        '320',
        'non-veg',
        'Main Kitchen',
        'Half:220 | Full:320',
        '',
        '25',
        'কলকাতা বিরিয়ানি',
        'Biryani Photo.JPG',
        'yes',
      ],
      // Entered now, but not on the menu yet.
      ['SPL-XMAS', 'Christmas Plum Cake', 'Desserts', '180', 'egg', '', '', '', '', '', '', 'no'],
      ['', '', '', '', '', '', '', '', '', '', '', ''],
    ];
    const images = { 'pnr-tka.webp': tikka, 'biryani photo.jpg': biryani, 'unused.png': spare };

    const preview = MenuImportResponseSchema.parse(
      (await admin('POST', '/menu/import', { rows, images, dryRun: true })).json(),
    );
    expect(preview.errors).toEqual([]);
    expect(preview).toMatchObject({ rows: 3, created: 3, updated: 0, unchanged: 0 });
    expect(preview.items.map((i) => [i.row, i.sku, i.action, i.image, i.imageFile])).toEqual([
      [2, 'PNR-TKA', 'create', 'set', 'pnr-tka.webp'],
      [3, 'BIR-CHK', 'create', 'set', 'biryani photo.jpg'],
      [4, 'SPL-XMAS', 'create', 'none', null],
    ]);
    expect(preview.warnings).toEqual([
      { row: 1, column: 'image', message: "unused.png isn't used by any row" },
    ]);
    expect((await admin('GET', '/menu-items')).json().data).toEqual([]);

    const done = MenuImportResponseSchema.parse(
      (await admin('POST', '/menu/import', { rows, images, dryRun: false })).json(),
    );
    expect(done).toMatchObject({ created: 3, errors: [] });
    const items = MenuItemSchema.array().parse(
      (await admin('GET', '/menu-items?includeInactive=true')).json().data,
    );
    const bySku = (sku: string) => items.find((i) => i.sku === sku)!;
    expect(bySku('PNR-TKA')).toMatchObject({ imageId: tikka, prepTimeSec: 900, isActive: true });
    expect(bySku('PNR-TKA').addonGroupIds).toHaveLength(1);
    expect(bySku('BIR-CHK')).toMatchObject({
      imageId: biryani,
      descriptionTranslations: { bn: 'কলকাতা বিরিয়ানি' },
      variants: [
        { name: 'Half', price: 22000 },
        { name: 'Full', price: 32000 },
      ],
    });
    expect(bySku('SPL-XMAS')).toMatchObject({ isActive: false, foodType: 'EGG', imageId: null });

    // The same sheet again: nothing to write.
    const again = MenuImportResponseSchema.parse(
      (await admin('POST', '/menu/import', { rows, images, dryRun: false })).json(),
    );
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(again.items.map((i) => i.image)).toEqual(['keep', 'keep', 'none']);
    const after = MenuItemSchema.array().parse(
      (await admin('GET', '/menu-items?includeInactive=true')).json().data,
    );
    expect(after.map((i) => i.version)).toEqual(items.map((i) => i.version));

    // A full-menu sync: one row, a new price for a size (its id stays), the photo removed,
    // and the dishes not in the sheet taken off the menu.
    const sync = MenuImportResponseSchema.parse(
      (
        await admin('POST', '/menu/import', {
          rows: [
            ['sku', 'name', 'category', 'price', 'variants', 'image'],
            ['BIR-CHK', 'Chicken Biryani', 'Biryani', '330', 'Half:230|Full:330', '-'],
          ],
          retireMissing: true,
          dryRun: false,
        })
      ).json(),
    );
    expect(sync).toMatchObject({ updated: 1, retired: [{ sku: 'PNR-TKA', name: 'Paneer Tikka' }] });
    expect(sync.items[0]).toMatchObject({ action: 'update', image: 'remove' });
    const synced = MenuItemSchema.array().parse(
      (await admin('GET', '/menu-items?includeInactive=true')).json().data,
    );
    const newBiryani = synced.find((i) => i.sku === 'BIR-CHK')!;
    expect(newBiryani.imageId).toBeNull();
    expect(newBiryani.variants.map((v) => [v.id, v.price])).toEqual(
      bySku('BIR-CHK').variants.map((v, i) => [v.id, [23000, 33000][i]]),
    );
    expect(synced.find((i) => i.sku === 'PNR-TKA')!.isActive).toBe(false);
  });

  it('points at the cell when a row is wrong, and writes nothing', async () => {
    const { admin } = await server();
    const rows = [
      header,
      ['A1', 'Dish', 'Mains', '100', 'veg', '', 'Half 100', '', '0', '', 'missing.jpg', 'maybe'],
      ['A2', 'Dish 2', 'Mains', '100', 'veg', '', 'Half:1|half:2', 'Nope', '', '', '', ''],
    ];
    const res = MenuImportResponseSchema.parse(
      (await admin('POST', '/menu/import', { rows, dryRun: false })).json(),
    );
    expect(res.errors.map((e) => [e.row, e.column])).toEqual([
      [2, 'prep_time_min'],
      [2, 'active'],
      [2, 'variants'],
      [2, 'image'],
      [3, 'variants'],
      [3, 'addon_groups'],
    ]);
    expect((await admin('GET', '/menu-items')).json().data).toEqual([]);

    const badHeader = MenuImportResponseSchema.parse(
      (
        await admin('POST', '/menu/import', { rows: [['sku', 'name', 'colour']], dryRun: true })
      ).json(),
    );
    expect(badHeader.errors.map((e) => e.message)).toEqual([
      'missing column "category"',
      'missing column "price"',
      'unknown column "colour"',
    ]);
    // An image id that isn't on the Hub can't be sent.
    const fake = await admin('POST', '/menu/import', {
      rows: [header, ['A1', 'Dish', 'Mains', '100']],
      images: { 'x.jpg': 'b'.repeat(64) },
      dryRun: true,
    });
    expect(fake.json().code).toBe('IMAGE_NOT_FOUND');
  });
});
