import type { ImageMime } from './image-info';

export interface NewMediaAsset {
  mime: ImageMime;
  width: number;
  height: number;
  bytes: Uint8Array;
  thumbMime: ImageMime;
  thumb: Uint8Array;
}

export interface MediaRepository {
  /**
   * Stores the asset under the SHA-256 of `bytes` and returns that id. The
   * same image stored twice keeps the first copy.
   */
  store(asset: NewMediaAsset, actorId: string | null, at: Date): string;
  exists(id: string): boolean;
  /** The full image or its thumbnail. */
  content(id: string, size: 'full' | 'thumb'): { mime: ImageMime; bytes: Uint8Array } | undefined;
}
