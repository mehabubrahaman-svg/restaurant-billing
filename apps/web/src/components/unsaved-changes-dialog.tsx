import type { Blocker } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './confirm-dialog';

/** Shown when in-app navigation is blocked by unsaved changes (see useUnsavedGuard). */
export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  const { t } = useTranslation();
  if (blocker.state !== 'blocked') return null;
  return (
    <ConfirmDialog
      title={t('common.unsavedTitle')}
      body={t('common.unsavedBody')}
      confirmLabel={t('common.leave')}
      destructive
      onConfirm={() => blocker.proceed()}
      onClose={() => blocker.reset()}
    />
  );
}
