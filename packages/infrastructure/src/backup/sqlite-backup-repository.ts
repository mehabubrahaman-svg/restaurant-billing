import type {
  BackupKind,
  BackupRecord,
  BackupRepository,
  BackupStatus,
} from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

interface Row {
  id: string;
  file_path: string;
  size_bytes: number;
  sha256: string;
  kind: BackupKind;
  status: BackupStatus;
  schema_version: number | null;
  copied_to: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
}

const SELECT = `SELECT b.*, u.full_name AS created_by_name FROM backups b LEFT JOIN users u ON u.id = b.created_by`;

export class SqliteBackupRepository implements BackupRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(r: Omit<BackupRecord, 'createdByName' | 'status'>): void {
    this.db
      .prepare(
        `INSERT INTO backups (id, file_path, size_bytes, sha256, is_encrypted, kind, status, schema_version,
                              copied_to, created_at, created_by)
         VALUES (?, ?, ?, ?, 1, ?, 'AVAILABLE', ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.filePath,
        r.sizeBytes,
        r.sha256,
        r.kind,
        r.schemaVersion,
        r.copiedTo,
        r.createdAt.toISOString(),
        r.createdBy,
      );
  }

  list(): BackupRecord[] {
    return this.db
      .prepare<[], Row>(`${SELECT} ORDER BY b.created_at DESC, b.rowid DESC`)
      .all()
      .map(toRecord);
  }

  get(id: string): BackupRecord | undefined {
    const row = this.db.prepare<[string], Row>(`${SELECT} WHERE b.id = ?`).get(id);
    return row && toRecord(row);
  }

  setStatus(id: string, status: BackupStatus, at: Date): void {
    this.db
      .prepare(
        `UPDATE backups SET status = ?, pruned_at = CASE WHEN ? = 'PRUNED' THEN ? ELSE pruned_at END WHERE id = ?`,
      )
      .run(status, status, at.toISOString(), id);
  }

  lastEventSeq(): number {
    return (
      this.db
        .prepare<[], number>('SELECT coalesce(max(seq), 0) FROM domain_events')
        .pluck()
        .get() ?? 0
    );
  }
}

function toRecord(r: Row): BackupRecord {
  return {
    id: r.id,
    filePath: r.file_path,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    kind: r.kind,
    status: r.status,
    // PRE_MIGRATION rows from before 0009 did not record it.
    schemaVersion: r.schema_version ?? 0,
    copiedTo: r.copied_to,
    createdAt: new Date(r.created_at),
    createdBy: r.created_by,
    createdByName: r.created_by_name,
  };
}
