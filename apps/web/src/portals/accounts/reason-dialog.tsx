import { Alert, Button, Dialog, Field, Textarea } from '@restroos/ui';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Asks why before an action that stays on the record: cancelling a purchase
 * order, a draft GRN or an expense, reversing a journal. The reason is kept
 * with the document and in the audit log.
 */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  busy,
  error,
  minLength = 3,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  busy: boolean;
  /** Translated error from the last attempt. */
  error: string | null;
  /** The Hub's minimum for this reason (3, or 1 for a purchase order). */
  minLength?: number;
  /** Extra fields under the reason (e.g. the reversal's date). */
  children?: ReactNode;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);

  function submit() {
    const ok = reason.trim().length >= minLength;
    setInvalid(!ok);
    if (ok) onConfirm(reason.trim());
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      dismissible={!busy}
      closeLabel={t('common.close')}
      title={title}
      {...(description === undefined ? {} : { description })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('accounts.reason.keep')}
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? t('common.saving') : confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label={t('accounts.reason.label')}
          required
          error={invalid ? t('accounts.reason.required', { min: minLength }) : undefined}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          )}
        </Field>
        {children}
        {error !== null && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
