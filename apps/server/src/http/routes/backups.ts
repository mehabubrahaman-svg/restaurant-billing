import type { BackupRecord } from '@restroos/application';
import {
  BACKUP_PASSPHRASE_HEADER,
  RestoreBackupRequestSchema,
  type Backup,
  type BackupsResponse,
  type RestoreBackupResponse,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
const MANAGE = { permission: 'backup.manage' } as const;
/** A busy restaurant's year is tens of MB; this leaves plenty of room. */
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

function toBackup(b: BackupRecord): Backup {
  return {
    id: b.id,
    fileName: basename(b.filePath),
    sizeBytes: b.sizeBytes,
    kind: b.kind,
    status: b.status,
    schemaVersion: b.schemaVersion,
    copiedTo: b.copiedTo,
    createdAt: b.createdAt.toISOString(),
    createdByName: b.createdByName,
  };
}

/** WP 5.8: list, take, download, import and restore backups (docs/05 §2 Backups). */
export async function backupRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { backupService: backups, config } = cradle;
  const find = (id: string) => {
    const backup = backups.list().find((b) => b.id === id);
    if (!backup) throw new DomainError('NOT_FOUND', 'backup not found');
    return backup;
  };

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_IMPORT_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.get('/backups', { config: MANAGE }, async (): Promise<BackupsResponse> => ({
    data: backups.list().map(toBackup),
    backupDir: config.backupDir,
    copyDir: config.backupCopyDir,
  }));

  app.post('/backups', { config: MANAGE }, async (request, reply): Promise<Backup> => {
    const backup = backups.create(commandContext(request));
    reply.status(201);
    return toBackup(backup);
  });

  app.get('/backups/:id/download', { config: MANAGE }, async (request, reply) => {
    const backup = find(IdParams.parse(request.params).id);
    if (backup.status !== 'AVAILABLE') {
      throw new DomainError('BACKUP_UNAVAILABLE', 'that backup file was pruned or is missing');
    }
    return reply
      .type('application/octet-stream')
      .header('content-disposition', `attachment; filename="${basename(backup.filePath)}"`)
      .send(createReadStream(backup.filePath));
  });

  app.post(
    '/backups/import',
    { config: MANAGE, bodyLimit: MAX_IMPORT_BYTES },
    async (request, reply): Promise<Backup> => {
      const passphrase = request.headers[BACKUP_PASSPHRASE_HEADER];
      if (typeof passphrase !== 'string' || passphrase === '') {
        throw new DomainError(
          'VALIDATION_FAILED',
          `send the backup passphrase in ${BACKUP_PASSPHRASE_HEADER}`,
        );
      }
      if (!Buffer.isBuffer(request.body)) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'send the .rbak file as application/octet-stream',
        );
      }
      const backup = await backups.import(request.body, passphrase, commandContext(request));
      reply.status(201);
      return toBackup(backup);
    },
  );

  app.post(
    '/backups/:id/restore',
    { config: MANAGE },
    async (request, reply): Promise<RestoreBackupResponse> => {
      const { id } = IdParams.parse(request.params);
      const { passphrase } = RestoreBackupRequestSchema.parse(request.body);
      const backup = await backups.restore(id, commandContext(request), passphrase);
      reply.status(202);
      return { backup: toBackup(backup), restarting: true };
    },
  );
}
