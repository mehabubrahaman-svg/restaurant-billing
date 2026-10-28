import type { PrintDocument } from '@restroos/contracts';
import { Alert, Button, cn, Dialog, Printer, Spinner } from '@restroos/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { QrImage } from '../../components/qr-image';
import { useErrorMessage } from '../../lib/errors';

/** One slip, drawn like the thermal printer would: a monospace column, about 42 characters wide. */
export function ReceiptSlip({ doc, className }: { doc: PrintDocument; className?: string }) {
  const { t } = useTranslation();
  const qrLabel = t('pos.print.qr');
  return (
    <div
      className={cn(
        'receipt-slip mx-auto w-full max-w-[24rem] bg-white p-4 font-mono text-[13px] leading-snug text-black shadow-sm',
        className,
      )}
    >
      {doc.blocks.map((b, i) => {
        switch (b.kind) {
          case 'text':
            return (
              <p
                key={i}
                className={cn(
                  'break-words whitespace-pre-wrap',
                  b.align === 'center' && 'text-center',
                  b.align === 'right' && 'text-end',
                  b.bold === true && 'font-bold',
                  b.size === 2 && 'text-lg',
                )}
              >
                {b.text}
              </p>
            );
          case 'row':
            return (
              <p
                key={i}
                className={cn(
                  'flex justify-between gap-3',
                  b.bold === true && 'font-bold',
                  b.size === 2 && 'text-lg',
                )}
              >
                <span className="min-w-0 break-words whitespace-pre-wrap">{b.left}</span>
                <span className="shrink-0 tabular-nums">{b.right}</span>
              </p>
            );
          case 'rule':
            return (
              <hr
                key={i}
                className={cn(
                  'my-1 border-0 border-t border-black',
                  b.char === '=' ? 'border-double border-t-4' : 'border-dashed',
                )}
              />
            );
          case 'feed':
            return <div key={i} style={{ height: `${b.lines * 1.25}em` }} aria-hidden="true" />;
          case 'qr':
            return (
              <QrImage key={i} value={b.data} label={qrLabel} className="mx-auto my-2 size-32" />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

/**
 * The bill as the printer would print it, with browser printing as the
 * fallback when there is no thermal printer or it is offline.
 */
export function ReceiptPreviewDialog({
  invoiceId,
  title,
  onClose,
  children,
}: {
  invoiceId: string;
  title: string;
  onClose: () => void;
  /** Shown above the slip, e.g. why the printer could not be used. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const receipt = useQuery({
    queryKey: ['billing', 'receipt', invoiceId],
    queryFn: () => api.billing.receipt(invoiceId),
  });
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      closeLabel={t('common.close')}
      title={title}
      description={t('pos.print.previewHint')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button disabled={receipt.data === undefined} onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            {t('pos.print.browser')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {children}
        {receipt.isPending && <Spinner label={t('common.loading')} />}
        {receipt.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(receipt.error)}
          </Alert>
        )}
        {receipt.data !== undefined && (
          <div className="rounded-lg bg-muted p-3">
            <ReceiptSlip doc={receipt.data} />
          </div>
        )}
      </div>
      {receipt.data !== undefined &&
        createPortal(
          // Only this copy shows on paper (see .print-only in index.css).
          <div className="print-only" aria-hidden="true">
            <ReceiptSlip doc={receipt.data} className="max-w-none p-0 shadow-none" />
          </div>,
          document.body,
        )}
    </Dialog>
  );
}
