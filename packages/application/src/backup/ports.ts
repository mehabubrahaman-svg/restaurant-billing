export type BackupKind = 'SCHEDULED' | 'MANUAL' | 'PRE_MIGRATION' | 'PRE_RESTORE' | 'IMPORTED';
export type BackupStatus = 'AVAILABLE' | 'PRUNED' | 'MISSING';

/** What every backup file says about itself in its (unencrypted) header. */
export interface BackupHeader {
  readonly format: 1;
  readonly createdAt: string;
  readonly kind: BackupKind;
  /** scrypt parameters and salt: the passphrase plus this re-derives the key on any PC. */
  readonly kdf: string;
  readonly schemaVersion: number;
  readonly organizationName: string | null;
  /** SHA-256 of the encrypted database that follows the header. */
  readonly sha256: string;
}

/** A backup file written to disk. */
export interface BackupFile {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly schemaVersion: number;
  readonly copiedTo: string | null;
}

export interface BackupRecord extends BackupFile {
  readonly id: string;
  readonly kind: BackupKind;
  readonly status: BackupStatus;
  readonly createdAt: Date;
  readonly createdBy: string | null;
  readonly createdByName: string | null;
}

/** The backup files themselves: snapshot, verify, restore. */
export interface BackupStore {
  /** Snapshots the live database into a new encrypted backup file. */
  snapshot(kind: BackupKind, at: Date): BackupFile;
  readHeader(filePath: string): BackupHeader;
  /** True when the file is still there and its checksum matches. */
  verify(filePath: string, sha256: string): boolean;
  /**
   * Decrypts and checks a backup, then leaves it ready to replace the live
   * database on the next start. `passphrase` is needed only for a backup
   * made with a different key (another PC, or an older passphrase).
   */
  stageRestore(filePath: string, passphrase?: string): Promise<void>;
  /** Saves an uploaded backup file next to ours, after checking the passphrase opens it. */
  importFile(
    bytes: Buffer,
    passphrase: string,
    at: Date,
  ): Promise<BackupFile & { header: BackupHeader }>;
  /** Removes the file (and its copy); the row stays, marked PRUNED. */
  remove(file: BackupFile): void;
  /** Files in the backup folder that no row knows about, e.g. after a restore. */
  untracked(known: ReadonlySet<string>): { file: BackupFile; header: BackupHeader }[];
}

export interface BackupRepository {
  insert(record: Omit<BackupRecord, 'createdByName' | 'status'>): void;
  list(): BackupRecord[];
  get(id: string): BackupRecord | undefined;
  setStatus(id: string, status: BackupStatus, at: Date): void;
  /** The domain_events high-water mark, to skip a scheduled backup when nothing changed. */
  lastEventSeq(): number;
}

/** Restarts the Hub process so a staged restore takes effect. */
export interface HubLifecycle {
  requestRestart(reason: string): void;
}
