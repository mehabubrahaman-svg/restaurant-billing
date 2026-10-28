import type { MonoBitmap, PrintDocument, RasterRenderer } from '@restroos/application';
import { readFileSync } from 'node:fs';

/** Runs a script in a Chromium page and returns its (JSON) result: Electron offscreen window, or Playwright. */
export type ScriptExecutor = (script: string) => Promise<unknown>;

export interface FontFile {
  readonly family: string;
  readonly weight: 400 | 700;
  readonly path: string;
}

/**
 * Draws slips with Chromium's text shaping and the bundled Noto fonts, so
 * Devanagari and Bengali print correctly on any ESC/POS printer (docs/01
 * §5.8). The page lays the slip out on a canvas and returns a 1-bit image.
 */
export class ChromiumRasterRenderer implements RasterRenderer {
  private readonly fonts: { family: string; weight: number; url: string }[];

  constructor(
    private readonly execute: ScriptExecutor,
    fonts: readonly FontFile[],
  ) {
    this.fonts = fonts.map((f) => ({
      family: f.family,
      weight: f.weight,
      url: `data:font/woff2;base64,${readFileSync(f.path).toString('base64')}`,
    }));
  }

  async render(doc: PrintDocument, widthDots: number): Promise<MonoBitmap> {
    const arg = JSON.stringify({ blocks: doc.blocks, width: widthDots, fonts: this.fonts });
    const result = (await this.execute(`(${DRAW})(${arg})`)) as {
      width: number;
      height: number;
      bits: string;
    };
    return {
      width: result.width,
      height: result.height,
      bits: Uint8Array.from(Buffer.from(result.bits, 'base64')),
    };
  }
}

/** Plain JavaScript, run inside the page (kept as a string so bundling can't change it). */
const DRAW = String.raw`async ({ blocks, width, fonts }) => {
  for (const f of fonts) {
    const face = new FontFace(f.family, 'url(' + f.url + ')', { weight: String(f.weight) });
    await face.load();
    document.fonts.add(face);
  }
  const family = '"Noto Sans", "Noto Sans Devanagari", "Noto Sans Bengali", sans-serif';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontOf = (size, bold) => (bold ? 700 : 400) + ' ' + (size === 2 ? 40 : 24) + 'px ' + family;
  const lineHeight = (size) => (size === 2 ? 54 : 34);
  const wrap = (text, max, font) => {
    ctx.font = font;
    const out = [];
    let line = '';
    for (const word of String(text).split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width <= max || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
    return out;
  };
  const ops = [];
  let y = 0;
  for (const b of blocks) {
    if (b.kind === 'text') {
      const font = fontOf(b.size, b.bold);
      for (const line of wrap(b.text, width, font)) {
        y += lineHeight(b.size);
        ops.push({ t: 'text', text: line, font, y: y - 10, align: b.align || 'left' });
      }
    } else if (b.kind === 'row') {
      const font = fontOf(b.size, b.bold);
      ctx.font = font;
      const rightWidth = b.right ? ctx.measureText(b.right).width : 0;
      const lines = wrap(b.left, Math.max(40, width - rightWidth - 16), font);
      lines.forEach((line, i) => {
        y += lineHeight(b.size);
        ops.push({ t: 'text', text: line, font, y: y - 10, align: 'left' });
        if (i === 0 && b.right) ops.push({ t: 'text', text: b.right, font, y: y - 10, align: 'right' });
      });
    } else if (b.kind === 'rule') {
      y += 18;
      ops.push({ t: 'rule', y: y - 9, double: b.char === '=' });
    } else if (b.kind === 'feed') {
      y += 34 * b.lines;
    }
  }
  canvas.width = width;
  canvas.height = Math.max(1, Math.ceil(y + 8));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  for (const op of ops) {
    if (op.t === 'text') {
      ctx.font = op.font;
      ctx.textAlign = op.align;
      const x = op.align === 'center' ? width / 2 : op.align === 'right' ? width : 0;
      ctx.fillText(op.text, x, op.y);
    } else {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, op.y);
      ctx.lineTo(width, op.y);
      if (op.double) { ctx.moveTo(0, op.y + 5); ctx.lineTo(width, op.y + 5); }
      ctx.stroke();
    }
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rowBytes = width / 8;
  const bits = new Uint8Array(rowBytes * canvas.height);
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      const lum = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      if (lum < 150) bits[py * rowBytes + (px >> 3)] |= 0x80 >> (px & 7);
    }
  }
  let binary = '';
  for (let i = 0; i < bits.length; i += 0x8000) binary += String.fromCharCode.apply(null, bits.subarray(i, i + 0x8000));
  return { width, height: canvas.height, bits: btoa(binary) };
}`;

/** The Noto fonts as @fontsource ships them (latin, devanagari, bengali; regular and bold). */
export function fontsourceFiles(fontsourceDir: string): FontFile[] {
  const sets: [string, string, string][] = [
    ['Noto Sans', 'noto-sans', 'latin'],
    ['Noto Sans Devanagari', 'noto-sans-devanagari', 'devanagari'],
    ['Noto Sans Bengali', 'noto-sans-bengali', 'bengali'],
  ];
  return sets.flatMap(([family, pkg, subset]) =>
    ([400, 700] as const).map((weight) => ({
      family,
      weight,
      path: `${fontsourceDir}/${pkg}/files/${pkg}-${subset}-${weight}-normal.woff2`,
    })),
  );
}
