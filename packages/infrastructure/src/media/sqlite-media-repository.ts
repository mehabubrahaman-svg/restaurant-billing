import { createHash } from 'node:crypto';
import type { MediaRepository, NewMediaAsset } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

type Mime = NewMediaAsset['mime'];

export class SqliteMediaRepository implements MediaRepository {
  constructor(private readonly db: SqliteDatabase) {}

  store(asset: NewMediaAsset, actorId: string | null, at: Date): string {
    const id = createHash('sha256').update(asset.bytes).digest('hex');
    this.db
      .prepare(
        `INSERT INTO media_assets (id, organization_id, mime, width, height, bytes, thumb_mime, thumb,
                                   created_at, created_by)
         VALUES (@id, (SELECT id FROM organizations LIMIT 1), @mime, @width, @height, @bytes, @thumbMime, @thumb,
                 @at, @actor)
         ON CONFLICT (id) DO NOTHING`,
      )
      .run({
        id,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        bytes: Buffer.from(asset.bytes),
        thumbMime: asset.thumbMime,
        thumb: Buffer.from(asset.thumb),
        at: at.toISOString(),
        actor: actorId,
      });
    return id;
  }

  exists(id: string): boolean {
    return (
      this.db
        .prepare<[string], number>('SELECT EXISTS (SELECT 1 FROM media_assets WHERE id = ?)')
        .pluck()
        .get(id) === 1
    );
  }

  content(id: string, size: 'full' | 'thumb'): { mime: Mime; bytes: Uint8Array } | undefined {
    const row = this.db
      .prepare<[string], { mime: Mime; bytes: Buffer }>(
        size === 'full'
          ? 'SELECT mime, bytes FROM media_assets WHERE id = ?'
          : 'SELECT thumb_mime AS mime, thumb AS bytes FROM media_assets WHERE id = ?',
      )
      .get(id);
    return row ? { mime: row.mime, bytes: new Uint8Array(row.bytes) } : undefined;
  }
}
