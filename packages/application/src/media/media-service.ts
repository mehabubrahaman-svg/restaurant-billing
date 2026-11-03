import { DomainError } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { CommandContext } from '../ports/unit-of-work';
import { inspectImage, type ImageInfo } from './image-info';
import type { MediaRepository } from './ports';

/**
 * Limits for an uploaded dish photo. The web app sends a full image (long
 * side up to 1280 px) and a square thumbnail (320 px), both already
 * re-encoded, so these only stop a client that skipped that.
 */
export const MEDIA_LIMITS = {
  maxImageBytes: 1_500_000,
  maxThumbBytes: 200_000,
  maxImageSide: 4096,
  maxThumbSide: 1024,
} as const;

/** A media asset id: the SHA-256 of the full image, in hex. */
export const MEDIA_ID = /^[0-9a-f]{64}$/;

export interface UploadedImage {
  id: string;
  width: number;
  height: number;
}

export class MediaService {
  constructor(private readonly d: { media: MediaRepository; clock: Clock }) {}

  uploadImage(
    input: { image: Uint8Array; thumbnail: Uint8Array },
    ctx: CommandContext,
  ): UploadedImage {
    const image = this.check(input.image, MEDIA_LIMITS.maxImageBytes, MEDIA_LIMITS.maxImageSide);
    const thumb = this.check(
      input.thumbnail,
      MEDIA_LIMITS.maxThumbBytes,
      MEDIA_LIMITS.maxThumbSide,
    );
    const id = this.d.media.store(
      {
        mime: image.mime,
        width: image.width,
        height: image.height,
        bytes: input.image,
        thumbMime: thumb.mime,
        thumb: input.thumbnail,
      },
      ctx.actorId,
      this.d.clock.now(),
    );
    return { id, width: image.width, height: image.height };
  }

  exists(id: string): boolean {
    return MEDIA_ID.test(id) && this.d.media.exists(id);
  }

  content(id: string, size: 'full' | 'thumb') {
    return MEDIA_ID.test(id) ? this.d.media.content(id, size) : undefined;
  }

  private check(bytes: Uint8Array, maxBytes: number, maxSide: number): ImageInfo {
    if (bytes.length === 0) throw new DomainError('IMAGE_INVALID', 'the file is empty');
    if (bytes.length > maxBytes) {
      throw new DomainError('IMAGE_TOO_LARGE', `at most ${Math.floor(maxBytes / 1000)} KB`);
    }
    const info = inspectImage(bytes);
    if (!info) throw new DomainError('IMAGE_INVALID', 'only PNG, JPEG or WebP images');
    if (info.width > maxSide || info.height > maxSide) {
      throw new DomainError('IMAGE_TOO_LARGE', `at most ${maxSide} px on a side`);
    }
    return info;
  }
}
