import { unzipSync } from 'fflate';
import { isPhotoFile, PHOTO } from '../../lib/dish-photos';

export interface PickedPhoto {
  /** The file name the sheet's `image` column (or the SKU) refers to. */
  readonly name: string;
  readonly file: Blob;
}

export interface SkippedFile {
  readonly name: string;
  readonly reason: 'notPhoto' | 'duplicate' | 'tooLarge' | 'badZip';
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';

/**
 * The photos among picked files: images as they are, and the images inside
 * any .zip (folders flattened, macOS metadata ignored). Two photos with one
 * file name can't both be meant, so the second is skipped.
 */
export async function collectPhotos(
  files: readonly File[],
  already: readonly PickedPhoto[] = [],
): Promise<{ photos: PickedPhoto[]; skipped: SkippedFile[] }> {
  const photos: PickedPhoto[] = [];
  const skipped: SkippedFile[] = [];
  const taken = new Set(already.map((p) => p.name.toLowerCase()));
  const add = (name: string, file: Blob) => {
    if (taken.has(name.toLowerCase())) return skipped.push({ name, reason: 'duplicate' });
    if (file.size > PHOTO.maxInputBytes) return skipped.push({ name, reason: 'tooLarge' });
    taken.add(name.toLowerCase());
    photos.push({ name, file });
  };

  for (const file of files) {
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
          filter: (f) => {
            const name = baseName(f.name);
            const wanted =
              !f.name.startsWith('__MACOSX/') && !name.startsWith('.') && isPhotoFile(name);
            if (wanted && f.originalSize > PHOTO.maxInputBytes) {
              skipped.push({ name, reason: 'tooLarge' });
              return false;
            }
            if (!wanted && !f.name.endsWith('/') && !f.name.startsWith('__MACOSX/'))
              skipped.push({ name, reason: 'notPhoto' });
            return wanted;
          },
        });
      } catch {
        skipped.push({ name: file.name, reason: 'badZip' });
        continue;
      }
      for (const [path, data] of Object.entries(entries)) {
        const name = baseName(path);
        add(name, new File([Uint8Array.from(data)], name, { type: mimeOf(name) }));
      }
    } else if (isPhotoFile(file.name)) {
      add(file.name, file);
    } else {
      skipped.push({ name: file.name, reason: 'notPhoto' });
    }
  }
  return { photos, skipped };
}
