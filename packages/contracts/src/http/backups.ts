import { z } from 'zod';

export const BackupKindSchema = z.enum([
  'SCHEDULED',
  'MANUAL',
  'PRE_MIGRATION',
  'PRE_RESTORE',
  'IMPORTED',
]);

export const BackupSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  kind: BackupKindSchema,
  status: z.enum(['AVAILABLE', 'PRUNED', 'MISSING']),
  schemaVersion: z.number().int(),
  /** The second copy (USB drive / NAS), when one was made. */
  copiedTo: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type Backup = z.infer<typeof BackupSchema>;

export const BackupsResponseSchema = z.object({
  data: z.array(BackupSchema),
  /** Where backups are written on the Hub, and the second copy target, for the admin screen. */
  backupDir: z.string(),
  copyDir: z.string().nullable(),
});
export type BackupsResponse = z.infer<typeof BackupsResponseSchema>;

/** Restoring replaces every record on the Hub with the backup's, so it is spelled out. */
export const RestoreBackupRequestSchema = z.object({
  confirm: z.literal('RESTORE'),
  /** Needed only for a backup made with another passphrase (or on another PC). */
  passphrase: z.string().min(1).max(200).optional(),
});

export const RestoreBackupResponseSchema = z.object({
  backup: BackupSchema,
  /** The Hub restarts to swap the database; clients reconnect and resync. */
  restarting: z.literal(true),
});
export type RestoreBackupResponse = z.infer<typeof RestoreBackupResponseSchema>;

/** Header for POST /backups/import (the body is the .rbak file). */
export const BACKUP_PASSPHRASE_HEADER = 'x-backup-passphrase';
