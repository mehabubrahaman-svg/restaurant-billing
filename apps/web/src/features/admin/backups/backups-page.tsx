import type { Backup } from '@restroos/contracts';
import {
  Alert,
  ArchiveRestore,
  Badge,
  Button,
  Card,
  DatabaseBackup,
  Dialog,
  Download,
  Field,
  FolderOpen,
  HardDrive,
  Input,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Upload,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { sizeParts } from '../../../lib/download';
import { useErrorMessage } from '../../../lib/errors';
import { startRestoreWait } from '../../backups/restore-store';
import { useDownload } from '../../reports/report-queries';
import { toast } from '../../toast/toast-store';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

export const BACKUPS_KEY = ['backups'] as const;
/** What the person must type to restore (kept in English: it is a code word, like the Hub's). */
export const RESTORE_WORD = 'RESTORE';

const KIND_VARIANT = {
  SCHEDULED: 'neutral',
  MANUAL: 'info',
  PRE_MIGRATION: 'outline',
  PRE_RESTORE: 'warning',
  IMPORTED: 'info',
} as const satisfies Record<Backup['kind'], string>;

const STATUS_VARIANT = {
  AVAILABLE: 'success',
  PRUNED: 'neutral',
  MISSING: 'danger',
} as const satisfies Record<Backup['status'], string>;

export function useFileSize() {
  const { t } = useTranslation();
  const format = useFormat();
  return (bytes: number) => {
    const { value, unit } = sizeParts(bytes);
    return t('backups.size', { value: format.number(value), unit });
  };
}

/** /admin/backups: the Hub's encrypted backups (docs/09 WP 5.8). */
export function BackupsPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const size = useFileSize();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const backups = useQuery({ queryKey: BACKUPS_KEY, queryFn: api.backups.list });
  const [importing, setImporting] = useState(false);
  const [restoring, setRestoring] = useState<Backup | null>(null);

  const create = useMutation({
    mutationFn: api.backups.create,
    onSuccess: (backup) => {
      toast(t('backups.created', { name: backup.fileName }));
      void queryClient.invalidateQueries({ queryKey: BACKUPS_KEY });
    },
    onError: (error) => toast(errorMessage(error), 'danger'),
  });
  const download = useDownload(
    (b: Backup) => api.backups.download(b.id),
    (b) => b.fileName,
  );

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('backups.title')}
        description={t('backups.description')}
        actions={
          <>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload aria-hidden="true" />
              {t('backups.import.action')}
            </Button>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              <DatabaseBackup aria-hidden="true" />
              {create.isPending ? t('backups.creating') : t('backups.create')}
            </Button>
          </>
        }
      />
      <QueryState query={backups}>
        {({ data, backupDir, copyDir }) => (
          <>
            <Card className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="flex min-w-0 items-start gap-3">
                <FolderOpen
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{t('backups.backupDir')}</h2>
                  <p className="font-mono text-sm break-all">{backupDir}</p>
                </div>
              </div>
              <div className="flex min-w-0 items-start gap-3">
                <HardDrive
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{t('backups.copyDir')}</h2>
                  {copyDir === null ? (
                    <p className="text-sm text-muted-foreground">{t('backups.noCopyDir')}</p>
                  ) : (
                    <p className="font-mono text-sm break-all">{copyDir}</p>
                  )}
                </div>
              </div>
            </Card>
            {data.length === 0 ? (
              <p className="text-muted-foreground">{t('backups.empty')}</p>
            ) : (
              <Table aria-label={t('backups.tableLabel', { count: data.length })}>
                <THead>
                  <Tr>
                    <Th>{t('backups.when')}</Th>
                    <Th>{t('backups.kind')}</Th>
                    <Th>{t('backups.status')}</Th>
                    <Th className="text-end">{t('backups.fileSize')}</Th>
                    <Th>{t('backups.by')}</Th>
                    <Th>
                      <span className="sr-only">{t('backups.actions')}</span>
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {[...data]
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((b) => (
                      <Tr key={b.id} data-kind={b.kind}>
                        <Td>
                          <span className="block whitespace-nowrap">
                            {format.dateTime(b.createdAt)}
                          </span>
                          <span className="block font-mono text-xs break-all text-muted-foreground">
                            {b.fileName}
                          </span>
                          {b.copiedTo !== null && (
                            <span className="block text-xs text-muted-foreground">
                              {t('backups.copied')}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <Badge variant={KIND_VARIANT[b.kind]} className="whitespace-nowrap">
                            {t(`backups.kinds.${b.kind}`)}
                          </Badge>
                        </Td>
                        <Td>
                          <Badge variant={STATUS_VARIANT[b.status]} className="whitespace-nowrap">
                            {t(`backups.statuses.${b.status}`)}
                          </Badge>
                        </Td>
                        <Td className="text-end whitespace-nowrap tabular-nums">
                          {size(b.sizeBytes)}
                        </Td>
                        <Td>{b.createdByName ?? t('backups.system')}</Td>
                        <Td>
                          {b.status === 'AVAILABLE' && (
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={download.isPending}
                                aria-label={t('backups.downloadNamed', { name: b.fileName })}
                                onClick={() => download.mutate(b)}
                              >
                                <Download aria-hidden="true" />
                                {t('backups.download')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={t('backups.restore.actionNamed', {
                                  date: format.dateTime(b.createdAt),
                                })}
                                onClick={() => setRestoring(b)}
                              >
                                <ArchiveRestore aria-hidden="true" />
                                {t('backups.restore.action')}
                              </Button>
                            </div>
                          )}
                        </Td>
                      </Tr>
                    ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </QueryState>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {restoring !== null && (
        <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} />
      )}
    </div>
  );
}

/** A .rbak file from a USB drive or another PC, opened with its passphrase. */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [errors, setErrors] = useState<{ file?: string; passphrase?: string }>({});
  const upload = useMutation({
    mutationFn: ({ f, p }: { f: File; p: string }) => api.backups.import(f, p),
    onSuccess: (backup) => {
      toast(t('backups.import.done', { name: backup.fileName }));
      void queryClient.invalidateQueries({ queryKey: BACKUPS_KEY });
      onClose();
    },
  });

  function submit() {
    const found: typeof errors = {};
    if (file === null) found.file = t('backups.import.fileRequired');
    if (passphrase === '') found.passphrase = t('backups.import.passphraseRequired');
    setErrors(found);
    if (file !== null && passphrase !== '') upload.mutate({ f: file, p: passphrase });
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      dismissible={!upload.isPending}
      closeLabel={t('common.close')}
      title={t('backups.import.title')}
      description={t('backups.import.description')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={upload.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="backup-import" disabled={upload.isPending}>
            <Upload aria-hidden="true" />
            {upload.isPending ? t('backups.import.uploading') : t('backups.import.submit')}
          </Button>
        </>
      }
    >
      <form
        id="backup-import"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {upload.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(upload.error)}
          </Alert>
        )}
        <Field label={t('backups.import.file')} error={errors.file} required>
          {(p) => (
            <Input
              {...p}
              type="file"
              accept=".rbak,application/octet-stream"
              className="h-auto py-2"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          )}
        </Field>
        <Field
          label={t('backups.passphrase')}
          hint={t('backups.import.passphraseHint')}
          error={errors.passphrase}
          required
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="off"
              value={passphrase}
              maxLength={200}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * Restoring replaces everything on the Hub, so it is spelled out and must be
 * confirmed by typing the code word. The Hub takes a safety backup first.
 */
function RestoreDialog({ backup, onClose }: { backup: Backup; onClose: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const [typed, setTyped] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const confirmed = typed.trim() === RESTORE_WORD;
  const restore = useMutation({
    mutationFn: () => api.backups.restore(backup.id, passphrase === '' ? undefined : passphrase),
    onSuccess: ({ backup: restored }) => {
      onClose();
      startRestoreWait(restored.createdAt);
    },
  });
  const date = format.dateTime(backup.createdAt);

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      dismissible={!restore.isPending}
      closeLabel={t('common.close')}
      title={t('backups.restore.title')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={restore.isPending} data-autofocus>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="backup-restore"
            variant="destructive"
            disabled={!confirmed || restore.isPending}
          >
            <ArchiveRestore aria-hidden="true" />
            {restore.isPending ? t('backups.restore.starting') : t('backups.restore.confirm')}
          </Button>
        </>
      }
    >
      <form
        id="backup-restore"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (confirmed) restore.mutate();
        }}
      >
        <Alert tone="danger" title={t('backups.restore.warningTitle', { date })}>
          {t('backups.restore.warning')}
        </Alert>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
          <li>{t('backups.restore.safety')}</li>
          <li>{t('backups.restore.restart')}</li>
          <li>{t('backups.restore.signIn')}</li>
        </ul>
        {restore.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(restore.error)}
          </Alert>
        )}
        <Field label={t('backups.passphrase')} hint={t('backups.restore.passphraseHint')}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="off"
              value={passphrase}
              maxLength={200}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('backups.restore.typeLabel', { word: RESTORE_WORD })}>
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
