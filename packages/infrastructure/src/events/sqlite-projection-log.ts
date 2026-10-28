import type { ProjectionLog, StoredEvent } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

/** domain_events read back by projectors, and their checkpoints (projection_checkpoints). */
export class SqliteProjectionLog implements ProjectionLog {
  constructor(private readonly db: SqliteDatabase) {}

  head(): number {
    return this.db
      .prepare<[], number>('SELECT coalesce(max(seq), 0) FROM domain_events')
      .pluck()
      .get()!;
  }

  checkpoint(name: string): number {
    return (
      this.db
        .prepare<[string], number>('SELECT last_seq FROM projection_checkpoints WHERE name = ?')
        .pluck()
        .get(name) ?? 0
    );
  }

  events(after: number, upTo: number, types: readonly string[], limit: number): StoredEvent[] {
    if (types.length === 0) return [];
    return this.db
      .prepare<
        (string | number)[],
        Omit<StoredEvent, 'payload' | 'actorId' | 'occurredAt'> & {
          payload: string;
          metadata: string | null;
          occurredAt: string;
        }
      >(
        `SELECT seq, event_type AS type, branch_id AS branchId, aggregate_id AS aggregateId,
                payload_json AS payload, metadata_json AS metadata, occurred_at AS occurredAt
           FROM domain_events
          WHERE seq > ? AND seq <= ? AND event_type IN (${types.map(() => '?').join(', ')})
          ORDER BY seq LIMIT ?`,
      )
      .all(after, upTo, ...types, limit)
      .map(({ metadata, ...e }) => ({
        ...e,
        payload: JSON.parse(e.payload) as unknown,
        actorId:
          metadata === null
            ? null
            : ((JSON.parse(metadata) as { actorId?: string | null }).actorId ?? null),
        occurredAt: new Date(e.occurredAt),
      }));
  }

  advance(name: string, seq: number, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO projection_checkpoints (name, last_seq, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET last_seq = max(last_seq, excluded.last_seq), updated_at = excluded.updated_at`,
      )
      .run(name, seq, at.toISOString());
  }
}
