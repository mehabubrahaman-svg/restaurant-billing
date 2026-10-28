import { Button, DatabaseBackup, Spinner, TriangleAlert } from '@restroos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../i18n/use-format';
import { refreshSession } from '../auth/auth-store';
import { toast } from '../toast/toast-store';
import { endRestoreWait, useRestoreStore, waitForHubRestart } from './restore-store';

/**
 * Covers the whole app while the Hub restarts after a restore. When it is
 * back: the session is renewed (or, if the restored data no longer knows it,
 * the user signs in again), and every screen refetches. The live socket
 * reconnects and resyncs on its own.
 */
export function RestoreOverlay() {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const phase = useRestoreStore((s) => s.phase);
  const createdAt = useRestoreStore((s) => s.backupCreatedAt);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase !== 'restoring') return;
    headingRef.current?.focus();
    const abort = new AbortController();
    void (async () => {
      const back = await waitForHubRestart(abort.signal);
      if (abort.signal.aborted) return;
      if (!back) {
        endRestoreWait('failed');
        return;
      }
      const outcome = await refreshSession();
      void queryClient.resetQueries();
      endRestoreWait('idle');
      toast(outcome === 'ok' ? t('backups.restore.done') : t('backups.restore.doneSignIn'));
    })();
    return () => abort.abort();
  }, [phase, queryClient, t]);

  if (phase === 'idle') return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-overlay-title"
      className="fixed inset-0 z-[100] grid place-items-center bg-background p-6 text-center"
    >
      <div className="flex max-w-md flex-col items-center gap-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
          {phase === 'failed' ? (
            <TriangleAlert aria-hidden="true" className="size-7" />
          ) : (
            <DatabaseBackup aria-hidden="true" className="size-7" />
          )}
        </span>
        <h1 id="restore-overlay-title" ref={headingRef} tabIndex={-1} className="text-xl font-bold">
          {phase === 'failed' ? t('backups.restore.slowTitle') : t('backups.restore.waitTitle')}
        </h1>
        <p className="text-muted-foreground">
          {phase === 'failed'
            ? t('backups.restore.slowBody')
            : createdAt === null
              ? t('backups.restore.waitBodyPlain')
              : t('backups.restore.waitBody', { date: format.dateTime(createdAt) })}
        </p>
        {phase === 'restoring' ? (
          <Spinner label={t('backups.restore.reconnecting')} />
        ) : (
          <Button onClick={() => window.location.reload()}>{t('common.reload')}</Button>
        )}
      </div>
    </div>
  );
}
