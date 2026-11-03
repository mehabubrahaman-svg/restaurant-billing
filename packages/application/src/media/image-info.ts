/**
 * What an uploaded file really is, from its first bytes rather than its name
 * or Content-Type: only PNG, JPEG and WebP are accepted, and their pixel size
 * is read from the header without decoding.
 */
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

export function inspectImage(b: Uint8Array): ImageInfo | null {
  return png(b) ?? jpeg(b) ?? webp(b);
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => (u16be(b, i) * 0x10000 + u16be(b, i + 2)) >>> 0;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function sized(mime: ImageMime, width: number, height: number): ImageInfo | null {
  return width > 0 && height > 0 ? { mime, width, height } : null;
}

function png(b: Uint8Array): ImageInfo | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || signature.some((v, i) => b[i] !== v) || ascii(b, 12, 4) !== 'IHDR')
    return null;
  return sized('image/png', u32be(b, 16), u32be(b, 20));
}

function jpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // Start-of-frame markers carry the size; C4 (DHT), C8 (JPG) and CC (DAC) don't.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return sized('image/jpeg', u16be(b, i + 7), u16be(b, i + 5));
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function webp(b: Uint8Array): ImageInfo | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  switch (ascii(b, 12, 4)) {
    case 'VP8 ':
      return sized('image/webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
    case 'VP8L':
      if (b[20] !== 0x2f) return null;
      return sized(
        'image/webp',
        1 + (((b[22]! & 0x3f) << 8) | b[21]!),
        1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)),
      );
    case 'VP8X':
      return sized('image/webp', 1 + u24le(b, 24), 1 + u24le(b, 27));
    default:
      return null;
  }
}
