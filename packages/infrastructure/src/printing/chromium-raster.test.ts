import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ChromiumRasterRenderer, fontsourceFiles } from './chromium-raster';
import { escPos } from './escpos';

const require = createRequire(import.meta.url);
const FONTS = join(__dirname, '../../../../apps/web/node_modules/@fontsource');
interface Playwright {
  chromium: {
    launch(): Promise<{
      newPage(): Promise<{ evaluate(s: string): Promise<unknown> }>;
      close(): Promise<void>;
    }>;
  };
}
let playwright: Playwright | undefined;
try {
  playwright = require('playwright') as Playwright;
} catch {
  playwright = undefined;
}
const available = playwright !== undefined && existsSync(FONTS);
let close: (() => Promise<void>) | undefined;
afterAll(async () => close?.());

describe.skipIf(!available)('Chromium raster renderer', () => {
  it('draws Bengali and Hindi text into a 1-bit image as wide as the paper', async () => {
    const browser = await playwright!.chromium.launch();
    close = () => browser.close();
    const page = await browser.newPage();
    const renderer = new ChromiumRasterRenderer(
      (script) => page.evaluate(script),
      fontsourceFiles(FONTS),
    );
    const bitmap = await renderer.render(
      {
        blocks: [
          { kind: 'text', text: 'স্পাইস রুট', align: 'center', bold: true, size: 2 },
          { kind: 'rule', char: '=' },
          { kind: 'row', left: '2 x চিকেন বিরিয়ানি (ফুল)', right: '720.00' },
          { kind: 'row', left: '4 x बटर नान', right: '240.00' },
          { kind: 'row', left: 'মোট / TOTAL', right: '₹1,008.00', bold: true, size: 2 },
        ],
        cut: true,
      },
      576,
    );
    expect(bitmap.width).toBe(576);
    expect(bitmap.height).toBeGreaterThan(150);
    const black = bitmap.bits.reduce((n, byte) => n + popcount(byte), 0);
    expect(black).toBeGreaterThan(2000); // there is ink
    const bytes = escPos.raster(bitmap, true);
    expect([...bytes.subarray(0, 4)]).toEqual([0x1b, 0x40, 0x1b, 0x61]);
    if (process.env['RASTER_DUMP']) writeFileSync(process.env['RASTER_DUMP'], pbm(bitmap));
  }, 30_000);
});

function popcount(b: number) {
  let n = 0;
  for (let v = b; v; v >>= 1) n += v & 1;
  return n;
}

/** Portable bitmap, to look at the result. */
function pbm(b: { width: number; height: number; bits: Uint8Array }) {
  return Buffer.concat([Buffer.from(`P4\n${b.width} ${b.height}\n`), Buffer.from(b.bits)]);
}
