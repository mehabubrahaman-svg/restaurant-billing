import { API_PREFIX } from '@restroos/contracts';

/**
 * Dish photos are prepared in the browser before upload: shrunk to at most
 * 1280 px on the long side, with a 320 px square thumbnail, and re-encoded
 * as WebP (JPEG where the browser can't write WebP). Re-encoding also drops
 * EXIF data, so a phone photo's GPS position never reaches the Hub. A 6 MB
 * phone photo becomes about 150 KB, which keeps the Hub's database and its
 * backups small and the POS fast on restaurant Wi-Fi.
 */
export const PHOTO = {
  maxSide: 1280,
  thumbSide: 320,
  maxUploadBytes: 1_500_000,
  /** What a person can pick: anything bigger is not a dish photo. */
  maxInputBytes: 25 * 1024 * 1024,
} as const;

export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

export interface PreparedPhoto {
  readonly image: Blob;
  readonly thumbnail: Blob;
  readonly width: number;
  readonly height: number;
}

/** Why a photo can't be used, for the person who picked it. */
export type PhotoProblem = 'unsupported' | 'tooLarge' | 'unreadable';

export class PhotoError extends Error {
  constructor(readonly problem: PhotoProblem) {
    super(problem);
  }
}

/** Where the Hub serves a photo; the thumbnail suits lists and POS tiles. */
export function photoUrl(imageId: string, size: 'full' | 'thumb' = 'thumb'): string {
  return `${API_PREFIX}/media/${imageId}${size === 'thumb' ? '/thumb' : ''}`;
}

export function isPhotoFile(name: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(name);
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function encode(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (webp) => {
        // Safari before 17 can't write WebP and hands back a PNG instead.
        if (webp !== null && webp.type === 'image/webp') return resolve(webp);
        c.toBlob(
          (jpeg) => (jpeg ? resolve(jpeg) : reject(new PhotoError('unreadable'))),
          'image/jpeg',
          quality,
        );
      },
      'image/webp',
      quality,
    );
  });
}

/** Shrinks, crops a thumbnail and re-encodes one photo. Throws PhotoError. */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  if (file.size > PHOTO.maxInputBytes) throw new PhotoError('tooLarge');
  if (file.type !== '' && !/^image\/(jpeg|png|webp)$/.test(file.type)) {
    // HEIC from iPhones: Chrome on Windows and Android can't decode it.
    throw new PhotoError('unsupported');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('unreadable');
  }
  try {
    const scale = Math.min(1, PHOTO.maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const full = canvas(width, height);
    const ctx = full.getContext('2d');
    if (ctx === null) throw new PhotoError('unreadable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    let image = await encode(full, 0.82);
    for (const quality of [0.7, 0.55]) {
      if (image.size <= PHOTO.maxUploadBytes) break;
      image = await encode(full, quality);
    }
    if (image.size > PHOTO.maxUploadBytes) throw new PhotoError('tooLarge');

    // The thumbnail: the middle square, so every tile lines up.
    const side = Math.min(bitmap.width, bitmap.height);
    const thumb = canvas(PHOTO.thumbSide, PHOTO.thumbSide);
    const tctx = thumb.getContext('2d');
    if (tctx === null) throw new PhotoError('unreadable');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      PHOTO.thumbSide,
      PHOTO.thumbSide,
    );
    const thumbnail = await encode(thumb, 0.78);
    return { image, thumbnail, width, height };
  } finally {
    bitmap.close();
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Runs `work` over `items`, `limit` at a time, keeping their order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
