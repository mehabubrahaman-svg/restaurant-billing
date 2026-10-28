import { DomainError } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type {
  BackupFile,
  BackupKind,
  BackupRecord,
  BackupRepository,
  BackupStore,
  HubLifecycle,
} from './ports';
import { backupsToPrune, DEFAULT_RETENTION, type RetentionPolicy } from './retention';

export interface BackupServiceDeps {
  readonly store: BackupStore;
  readonly backups: BackupRepository;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly lifecycle: HubLifecycle;
  readonly timeZone: string;
  readonly retention?: RetentionPolicy;
}

/** A scheduled backup this soon after the last one is skipped (e.g. after a restart). */
const MIN_SCHEDULED_GAP_MS = 50 * 60_000;

/** WP 5.8: encrypted hot backups, retention and restore (docs/01 §5.5). */
export class BackupService {
  private lastScheduledSeq: number | null = null;

  constructor(private readonly d: BackupServiceDeps) {}

  list(): BackupRecord[] {
    return this.d.backups.list();
  }

  /** A backup someone asked for. Runs outside any transaction: VACUUM INTO can't run inside one. */
  create(ctx: CommandContext, kind: BackupKind = 'MANUAL'): BackupRecord {
    const now = this.d.clock.now();
    const file = this.d.store.snapshot(kind, now);
    const id = this.d.ids.next();
    this.d.unitOfWork.run(ctx, (scope) => {
      this.record(id, kind, file, now, ctx.actorId);
      scope.audit({
        action: 'backup.create',
        entityType: 'Backup',
        entityId: id,
        after: { kind, sizeBytes: file.sizeBytes },
      });
    });
    return this.d.backups.get(id)!;
  }

  /**
   * The hourly job. Skips when nothing was written since the last scheduled
   * backup, then applies retention. Returns the new backup, if one was made.
   */
  scheduled(): BackupRecord | null {
    const now = this.d.clock.now();
    const seq = this.d.backups.lastEventSeq();
    const latest = this.d.backups
      .list()
      .find((b) => b.kind === 'SCHEDULED' && b.status === 'AVAILABLE');
    const recent = latest && now.getTime() - latest.createdAt.getTime() < MIN_SCHEDULED_GAP_MS;
    let made: BackupRecord | null = null;
    if (seq !== this.lastScheduledSeq && !recent) {
      const file = this.d.store.snapshot('SCHEDULED', now);
      const id = this.d.ids.next();
      this.record(id, 'SCHEDULED', file, now, null);
      made = this.d.backups.get(id)!;
    }
    this.lastScheduledSeq = seq;
    this.prune();
    return made;
  }

  /** Deletes the files retention no longer needs; their rows stay, marked PRUNED. */
  prune(): number {
    const now = this.d.clock.now();
    const available = this.d.backups.list().filter((b) => b.status === 'AVAILABLE');
    const ids = new Set(
      backupsToPrune(available, now, this.d.timeZone, this.d.retention ?? DEFAULT_RETENTION),
    );
    for (const b of available.filter((b) => ids.has(b.id))) {
      this.d.store.remove(b);
      this.d.backups.setStatus(b.id, 'PRUNED', now);
    }
    return ids.size;
  }

  /**
   * Checks the backup, takes a PRE_RESTORE backup of the current data, stages
   * the restore and restarts the Hub, which swaps the files before opening the
   * database.
   */
  async restore(id: string, ctx: CommandContext, passphrase?: string): Promise<BackupRecord> {
    const backup = this.d.backups.get(id);
    if (!backup) throw new DomainError('NOT_FOUND', 'backup not found');
    if (backup.status !== 'AVAILABLE' || !this.d.store.verify(backup.filePath, backup.sha256)) {
      if (backup.status === 'AVAILABLE')
        this.d.backups.setStatus(id, 'MISSING', this.d.clock.now());
      throw new DomainError('BACKUP_UNAVAILABLE', 'the backup file is missing or damaged');
    }
    const safety = this.create(ctx, 'PRE_RESTORE');
    await this.d.store.stageRestore(backup.filePath, passphrase);
    this.d.unitOfWork.run(ctx, (scope) =>
      scope.audit({
        action: 'backup.restore',
        entityType: 'Backup',
        entityId: id,
        after: { createdAt: backup.createdAt.toISOString(), safetyBackupId: safety.id },
      }),
    );
    this.d.lifecycle.requestRestart(`restoring backup ${id}`);
    return backup;
  }

  /** Adds a backup file brought from elsewhere (USB drive, old PC) to the list. */
  async import(bytes: Buffer, passphrase: string, ctx: CommandContext): Promise<BackupRecord> {
    const now = this.d.clock.now();
    const file = await this.d.store.importFile(bytes, passphrase, now);
    const id = this.d.ids.next();
    this.d.unitOfWork.run(ctx, (scope) => {
      this.record(id, 'IMPORTED', file, new Date(file.header.createdAt), ctx.actorId);
      scope.audit({
        action: 'backup.import',
        entityType: 'Backup',
        entityId: id,
        after: { createdAt: file.header.createdAt, sizeBytes: file.sizeBytes },
      });
    });
    return this.d.backups.get(id)!;
  }

  /**
   * Lists backup files the database doesn't know about. After a restore, the
   * restored database predates the newer backups (and the PRE_RESTORE one).
   */
  adoptUntracked(): number {
    const known = new Set(this.d.backups.list().map((b) => b.filePath));
    const found = this.d.store.untracked(known);
    for (const { file, header } of found) {
      this.record(this.d.ids.next(), header.kind, file, new Date(header.createdAt), null);
    }
    return found.length;
  }

  private record(
    id: string,
    kind: BackupKind,
    file: BackupFile,
    createdAt: Date,
    createdBy: string | null,
  ) {
    this.d.backups.insert({
      id,
      kind,
      filePath: file.filePath,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      schemaVersion: file.schemaVersion,
      copiedTo: file.copiedTo,
      createdAt,
      createdBy,
    });
  }
}
