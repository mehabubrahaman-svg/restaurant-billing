import type { Invoice } from '@restroos/contracts';
import { Alert, Button, Eye, Printer } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { withApproval } from '../../features/approval/with-approval';
import { BILLING_KEYS } from '../../features/billing/billing-queries';
import { toast } from '../../features/toast/toast-store';
import { useErrorMessage } from '../../lib/errors';
import { ReceiptPreviewDialog } from './receipt-preview';

/** Printer problems the browser can stand in for. */
const FALLBACK = ['NO_PRINTER', 'PRINTER_OFFLINE', 'PRINTER_ON_DEVICE', 'PRINTER_UNSUPPORTED'];

/**
 * Print (the original) or Reprint (marked DUPLICATE; billing.reprint or a
 * manager) on the bill printer, and a preview that can be printed from the
 * browser when there is no thermal printer or it does not answer.
 */
export function PrintInvoiceActions({
  invoice,
  compact = false,
}: {
  invoice: Pick<Invoice, 'id' | 'invoiceNo' | 'printCount' | 'orderId'>;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [preview, setPreview] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const reprint = invoice.printCount > 0;

  const print = useMutation({
    mutationFn: () =>
      withApproval((approverToken) =>
        api.billing.print(invoice.id, approverToken === undefined ? {} : { approverToken }),
      ),
    onSuccess: (outcome) => {
      setProblem(null);
      toast(t('pos.print.sent', { printer: outcome.printerName }));
      void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.invoice(invoice.id) });
      void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.orderInvoices(invoice.orderId) });
    },
    onError: (error) => {
      if (FALLBACK.some((code) => isApiError(error, code))) {
        setProblem(errorMessage(error));
        setPreview(true);
      } else toast(errorMessage(error), 'danger');
    },
  });

  const size = compact ? 'sm' : undefined;
  return (
    <>
      <Button
        variant="outline"
        size={size}
        disabled={print.isPending}
        onClick={() => print.mutate()}
        aria-label={
          compact
            ? reprint
              ? t('pos.print.reprintNamed', { number: invoice.invoiceNo })
              : t('pos.print.printNamed', { number: invoice.invoiceNo })
            : undefined
        }
      >
        <Printer aria-hidden="true" />
        {print.isPending
          ? t('pos.print.printing')
          : reprint
            ? t('pos.print.reprint')
            : t('pos.print.print')}
      </Button>
      <Button
        variant="ghost"
        size={size}
        onClick={() => {
          setProblem(null);
          setPreview(true);
        }}
        aria-label={
          compact ? t('pos.print.previewNamed', { number: invoice.invoiceNo }) : undefined
        }
      >
        <Eye aria-hidden="true" />
        {t('pos.print.preview')}
      </Button>
      {preview && (
        <ReceiptPreviewDialog
          invoiceId={invoice.id}
          title={t('pos.print.previewTitle', { number: invoice.invoiceNo })}
          onClose={() => setPreview(false)}
        >
          {problem !== null && (
            <Alert tone="warning" role="alert">
              {problem} {t('pos.print.fallback')}
            </Alert>
          )}
        </ReceiptPreviewDialog>
      )}
    </>
  );
}
