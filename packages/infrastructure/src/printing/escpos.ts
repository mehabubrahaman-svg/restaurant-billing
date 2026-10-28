import type { EscPosEncoder, MonoBitmap, PrintDocument } from '@restroos/application';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * ESC/POS (Epson-compatible) bytes for the thermal printers sold in India.
 * Text mode uses the printer's built-in font, so only ASCII is sent: ₹ becomes
 * "Rs.". Anything else is printed as a raster image instead.
 */
export const escPos: EscPosEncoder = {
  text(doc: PrintDocument, columns: number): Uint8Array {
    const out = new Bytes();
    out.push(ESC, 0x40); // initialise
    for (const block of doc.blocks) {
      switch (block.kind) {
        case 'text': {
          out.push(ESC, 0x61, block.align === 'center' ? 1 : block.align === 'right' ? 2 : 0);
          out.push(ESC, 0x45, block.bold ? 1 : 0);
          out.push(GS, 0x21, block.size === 2 ? 0x11 : 0x00);
          const width = block.size === 2 ? Math.floor(columns / 2) : columns;
          for (const line of wrap(ascii(block.text), width)) out.text(line).push(LF);
          break;
        }
        case 'row': {
          out.push(
            ESC,
            0x61,
            0,
            ESC,
            0x45,
            block.bold ? 1 : 0,
            GS,
            0x21,
            block.size === 2 ? 0x11 : 0x00,
          );
          const width = block.size === 2 ? Math.floor(columns / 2) : columns;
          for (const line of twoColumns(ascii(block.left), ascii(block.right), width))
            out.text(line).push(LF);
          break;
        }
        case 'rule':
          out
            .push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0)
            .text((block.char ?? '-').repeat(columns))
            .push(LF);
          break;
        case 'qr':
          out.push(ESC, 0x61, 1);
          qr(out, block.data);
          break;
        case 'feed':
          out.push(ESC, 0x64, Math.min(block.lines, 10));
          break;
      }
    }
    out.push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0);
    if (doc.cut) out.push(ESC, 0x64, 4, GS, 0x56, 0x42, 0); // feed and partial cut
    return out.bytes();
  },

  raster(bitmap: MonoBitmap, cut: boolean): Uint8Array {
    const out = new Bytes();
    out.push(ESC, 0x40, ESC, 0x61, 0);
    const rowBytes = bitmap.width / 8;
    // Bands of at most 256 rows: small enough for every printer's buffer.
    for (let y = 0; y < bitmap.height; y += 256) {
      const rows = Math.min(256, bitmap.height - y);
      out.push(GS, 0x76, 0x30, 0, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8);
      out.append(bitmap.bits.subarray(y * rowBytes, (y + rows) * rowBytes));
    }
    if (cut) out.push(ESC, 0x64, 4, GS, 0x56, 0x42, 0);
    return out.bytes();
  },
};

class Bytes {
  private chunks: number[] = [];
  push(...values: number[]): this {
    this.chunks.push(...values);
    return this;
  }
  text(s: string): this {
    for (let i = 0; i < s.length; i++) this.chunks.push(s.charCodeAt(i) & 0x7f);
    return this;
  }
  append(data: Uint8Array): this {
    for (const b of data) this.chunks.push(b);
    return this;
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/** Printable ASCII only. */
export function ascii(text: string): string {
  return text
    .replaceAll('₹', 'Rs.')
    .replaceAll(/[‘’]/g, "'")
    .replaceAll(/[“”]/g, '"')
    .replaceAll(/[–—]/g, '-')
    .replaceAll('×', 'x')
    .replaceAll(/[^\x20-\x7e]/g, '?');
}

export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (word.length > width) {
        if (line) lines.push(line);
        for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
        line = '';
      } else if (line === '') line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Left text wrapped to fit beside a right-aligned value on the first line. */
export function twoColumns(left: string, right: string, width: number): string[] {
  const room = Math.max(1, width - right.length - 1);
  const [first = '', ...rest] = wrap(left, room);
  return [first.padEnd(width - right.length) + right, ...rest];
}

function qr(out: Bytes, data: string): void {
  const bytes = Array.from(Buffer.from(data, 'utf8'));
  const len = bytes.length + 3;
  out.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0); // model 2
  out.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6); // module size
  out.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // error correction M
  out.push(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...bytes); // store
  out.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, LF); // print
}
