import { Alert, Button, Dialog } from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** "Are you sure?" for actions that are hard to undo (retire, unpair, rotate a QR). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  /** Translated error from the last attempt, shown above the buttons. */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      dismissible={!busy}
      closeLabel={t('common.close')}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy} data-autofocus>
            {t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="text-foreground">{body}</div>
        {error !== undefined && error !== null && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
