import { Button, Printer } from '@restroos/ui';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { usePermission } from '../auth/permissions';
import { toast } from '../toast/toast-store';

/** Who may reprint a KOT: the kitchen, and whoever sends orders to it. */
export const KOT_REPRINT_PERMISSIONS = ['kds.view', 'orders.fire_kot'] as const;

/**
 * Prints a KOT again on its station's printer (marked REPRINT on the slip),
 * e.g. when the first one jammed. Hidden for users who may not.
 */
export function ReprintKotButton({
  kotId,
  kotNo,
  iconOnly = false,
  className,
}: {
  kotId: string;
  kotNo: number;
  /** Just the printer icon (the KDS card, where space is tight); the name stays for screen readers. */
  iconOnly?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const allowed = usePermission(KOT_REPRINT_PERMISSIONS);
  const reprint = useMutation({
    mutationFn: () => api.kitchen.reprint(kotId),
    onSuccess: ({ data }) => {
      if (data.length === 0) toast(t('kds.reprint.none'), 'warning');
      else toast(t('pos.print.sent', { printer: data.map((o) => o.printerName).join(', ') }));
    },
    onError: (error) => toast(errorMessage(error), 'danger'),
  });
  if (!allowed) return null;
  return (
    <Button
      variant="outline"
      size={iconOnly ? 'icon' : 'touch'}
      className={className}
      disabled={reprint.isPending}
      aria-label={t('kds.reprint.named', { kotNo })}
      title={iconOnly ? t('kds.reprint.named', { kotNo }) : undefined}
      onClick={() => reprint.mutate()}
    >
      <Printer aria-hidden="true" />
      {!iconOnly && (reprint.isPending ? t('pos.print.printing') : t('kds.reprint.action'))}
    </Button>
  );
}
