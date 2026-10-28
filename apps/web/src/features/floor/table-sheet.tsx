import type { DiningTable } from '@restroos/contracts';
import { Alert, Badge, Button, CHIP_LOOKS, Dialog, StateChip, UtensilsCrossed } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api, type ManualTableStatus } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { usePermission } from '../auth/permissions';
import { toast } from '../toast/toast-store';
import { FLOOR_KEY, mergeTables } from './floor-queries';
import { allowedTransitions, STATUS_CHIP } from './table-status';

/**
 * Tapping a table on the captain floor: its status, the manual status
 * changes allowed from here, and (Sprint 4) taking the order.
 */
export function TableSheet({
  table,
  areaName,
  onClose,
}: {
  table: DiningTable;
  areaName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canChange = usePermission(['tables.update_status', 'floor.manage']);
  const state = STATUS_CHIP[table.status];
  const options = allowedTransitions(table.status);

  const change = useMutation({
    mutationFn: (status: ManualTableStatus) => api.floor.setStatus(table.id, status, table.version),
    onSuccess: (updated) => {
      mergeTables(queryClient, [updated]);
      toast(
        t('captain.statusChanged', {
          label: updated.label,
          status: t(`state.table.${STATUS_CHIP[updated.status]}`),
        }),
      );
      onClose();
    },
    onError: (error) => {
      // Someone else changed the table: show the latest state behind the message.
      if (isApiError(error, 'VERSION_CONFLICT') || isApiError(error, 'INVALID_STATE_TRANSITION')) {
        void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
      }
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!change.isPending}
      closeLabel={t('common.close')}
      title={t('captain.tableTitle', { label: table.label })}
      description={t('captain.tableMeta', { area: areaName, seats: table.seats })}
      size="sm"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('captain.status')}</span>
          <StateChip state={state} label={t(`state.table.${state}`)} />
        </div>

        {change.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(change.error)}
          </Alert>
        )}

        <section className="flex flex-col gap-2" aria-labelledby="table-sheet-status">
          <h3 id="table-sheet-status" className="text-sm font-semibold">
            {t('captain.changeStatus')}
          </h3>
          {!canChange ? (
            <p className="text-sm text-muted-foreground">{t('captain.noStatusPermission')}</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('captain.orderDriven')}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {options.map((status) => {
                const chip = STATUS_CHIP[status];
                const Icon = CHIP_LOOKS[chip].icon;
                return (
                  <li key={status}>
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      data-status={status}
                      disabled={change.isPending}
                      onClick={() => change.mutate(status)}
                    >
                      <Icon aria-hidden="true" />
                      {t(`captain.markAs.${status}`)}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t pt-4">
          <Button size="lg" disabled aria-describedby="take-order-note">
            <UtensilsCrossed aria-hidden="true" />
            {t('captain.takeOrder')}
          </Button>
          <p
            id="take-order-note"
            className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
          >
            <Badge variant="warning">{t('placeholder.badge')}</Badge>
            {t('captain.takeOrderNext')}
          </p>
        </section>
      </div>
    </Dialog>
  );
}
