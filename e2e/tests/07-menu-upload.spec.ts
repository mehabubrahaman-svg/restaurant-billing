/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { apiAs, OWNER, signIn } from '../support/restaurant';

/** A real photo, drawn by the browser: a phone-sized JPEG or PNG. */
async function photo(page: Page, type: 'image/jpeg' | 'image/png', width: number, height: number) {
  const dataUrl = await page.evaluate(
    ({ type, width, height }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#c2410c');
      g.addColorStop(1, '#fde68a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, Math.PI * 2);
      ctx.fill();
      return c.toDataURL(type, 0.95);
    },
    { type, width, height },
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

test('menu upload: the Excel template with photos, previewed and imported', async ({
  page,
  request,
}) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.goto('/admin/menu/import');
  await expect(page.getByRole('heading', { name: 'Upload menu' })).toBeVisible();

  // The template comes from the app itself: examples, instructions and this Hub's lists.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download template (Excel)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('restroos-menu-template.xlsx');
  const template = readFileSync((await download.path())!);

  await page
    .locator('input[type=file][accept*=".xlsx"]')
    .setInputFiles({ name: 'menu.xlsx', mimeType: 'application/octet-stream', buffer: template });
  await expect(page.getByText(/sheet “Menu items”, 4 rows/)).toBeVisible();

  // The biryani's photo is named in its image column; the paneer's is named after its SKU.
  const big = await photo(page, 'image/jpeg', 4000, 3000);
  await page.locator('input[type=file][multiple]').setInputFiles([
    { name: 'chicken-biryani.jpg', mimeType: 'image/jpeg', buffer: big },
    {
      name: 'CUR-PBM.png',
      mimeType: 'image/png',
      buffer: await photo(page, 'image/png', 900, 1200),
    },
  ]);
  await expect(page.getByText('2 photos added')).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/menu-upload-choose.png' });

  await page.getByRole('button', { name: 'Check file' }).click();
  const preview = page.getByRole('table', { name: 'What the import will do' });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByRole('img', { name: 'Photo of Chicken Biryani' })).toBeVisible();
  await expect(preview.getByRole('img', { name: 'Photo of Paneer Butter Masala' })).toBeVisible();
  // The stock set-up already has a biryani with this SKU: it is updated, the rest are new.
  await expect(preview.getByRole('row')).toHaveCount(5);
  await page
    .locator('section, div')
    .filter({ has: page.getByRole('heading', { name: '3. Check and import' }) })
    .last()
    .screenshot({ path: 'test-results/shots/menu-upload-preview.png' });

  await page.getByRole('button', { name: /^Import \d items$/ }).click();
  await expect(page.getByText('Menu imported')).toBeVisible();

  // The Hub has the photos, shrunk and re-encoded, served with long caching.
  const api = await apiAs(request, OWNER.username, OWNER.password);
  const { data } = await api<{ data: { sku: string; imageId: string | null }[] }>(
    'GET',
    '/menu-items',
  );
  const biryani = data.find((i) => i.sku === 'BIR-CHK')!;
  const paneer = data.find((i) => i.sku === 'CUR-PBM')!;
  expect(biryani.imageId).toMatch(/^[0-9a-f]{64}$/);
  expect(paneer.imageId).toMatch(/^[0-9a-f]{64}$/);
  expect(data.find((i) => i.sku === 'BEV-CHAI')!.imageId).toBeNull();
  const full = await request.get(`/api/v1/media/${biryani.imageId}`);
  expect(full.headers()['content-type']).toBe('image/webp');
  expect(full.headers()['cache-control']).toContain('immutable');
  const bytes = await full.body();
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
  expect(bytes.length).toBeLessThan(big.length);
  // Long side 1280 px: read from the WebP header (VP8X, VP8L or VP8).
  const chunk = bytes.subarray(12, 16).toString('ascii');
  const width =
    chunk === 'VP8X'
      ? 1 + bytes.readUIntLE(24, 3)
      : chunk === 'VP8L'
        ? 1 + (((bytes[22]! & 0x3f) << 8) | bytes[21]!)
        : bytes.readUInt16LE(26) & 0x3fff;
  expect(width).toBe(1280);
  const thumb = await request.get(`/api/v1/media/${biryani.imageId}/thumb`);
  expect(thumb.ok()).toBe(true);

  // The dishes show their photos in the admin menu.
  await page.goto('/admin/menu');
  await expect(page.locator(`img[src$="${paneer.imageId}/thumb"]`).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/menu-with-photos.png' });

  // And on the dish's own page, where a photo can be replaced or removed.
  await page.getByRole('link', { name: 'Edit Paneer Butter Masala' }).click();
  await expect(page.getByRole('img', { name: 'Photo of Paneer Butter Masala' })).toBeVisible();
  await page.getByRole('heading', { name: 'Photo' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/shots/item-photo.png' });
});
