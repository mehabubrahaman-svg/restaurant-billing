import type { DiningTable } from '@restroos/contracts';
import {
  Alert,
  ArrowRightLeft,
  Button,
  CHIP_LOOKS,
  cn,
  Dialog,
  Merge,
  StateChip,
  UtensilsCrossed,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { isApiError, newIdempotencyKey } from '../../api/client';
import { api, type ManualTableStatus, type TransferMode } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { usePermission } from '../auth/permissions';
import { setOrder } from '../orders/order-queries';
import { toast } from '../toast/toast-store';
import { FLOOR_KEY, mergeTables } from './floor-queries';
import { allowedTransitions, STATUS_CHIP } from './table-status';

/**
 * A table's actions (long-press or ⋮ on the captain floor): its status, the
 * manual status changes allowed from here, taking an order, and moving or
 * merging its running order.
 */
export function TableSheet({
  table,
  areaName,
  tables,
  onClose,
  onTakeOrder,
}: {
  table: DiningTable;
  areaName: string;
  /** Every active table, for move / merge targets. */
  tables: readonly DiningTable[];
  onClose: () => void;
  onTakeOrder: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canChange = usePermission(['tables.update_status', 'floor.manage']);
  const canTransfer = usePermission('orders.transfer_table');
  const canCreate = usePermission('orders.create');
  const [transfer, setTransfer] = useState<TransferMode | null>(null);
  const state = STATUS_CHIP[table.status];
  const options = allowedTransitions(table.status);
  const orderId = table.openOrder?.id ?? table.currentOrderId;
  const free = table.status === 'AVAILABLE' || table.status === 'RESERVED';

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

  if (transfer !== null) {
    return (
      <TransferDialog
        table={table}
        mode={transfer}
        tables={tables}
        onClose={() => setTransfer(null)}
        onDone={onClose}
      />
    );
  }

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

        {(orderId !== null || (free && canCreate)) && (
          <section className="flex flex-col gap-2">
            {orderId !== null ? (
              <>
                <Button
                  size="lg"
                  onClick={() => {
                    onClose();
                    void navigate(`/captain/orders/${orderId}`);
                  }}
                >
                  <UtensilsCrossed aria-hidden="true" />
                  {t('captain.openOrder')}
                </Button>
                {canTransfer && table.status === 'OCCUPIED' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button variant="outline" onClick={() => setTransfer('MOVE')}>
                      <ArrowRightLeft aria-hidden="true" />
                      {t('captain.transfer.move')}
                    </Button>
                    <Button variant="outline" onClick={() => setTransfer('MERGE')}>
                      <Merge aria-hidden="true" />
                      {t('captain.transfer.merge')}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <Button size="lg" onClick={onTakeOrder}>
                <UtensilsCrossed aria-hidden="true" />
                {t('captain.takeOrder')}
              </Button>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2 border-t pt-4" aria-labelledby="table-sheet-status">
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
      </div>
    </Dialog>
  );
}

/** Pick the target table: MOVE needs a free one, MERGE one with a running order. */
export function TransferDialog({
  table,
  mode,
  tables,
  onClose,
  onDone,
}: {
  table: DiningTable;
  mode: TransferMode;
  tables: readonly DiningTable[];
  onClose: () => void;
  onDone: (orderId: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [target, setTarget] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);
  const candidates = tables
    .filter((x) => x.id !== table.id && x.isActive)
    .filter((x) =>
      mode === 'MOVE'
        ? x.status === 'AVAILABLE'
        : x.status === 'OCCUPIED' && (x.openOrder !== null || x.currentOrderId !== null),
    )
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const targetLabel = candidates.find((x) => x.id === target)?.label ?? '';

  const run = useMutation({
    mutationFn: (targetId: string) =>
      api.floor.transfer(table.id, targetId, mode, { idempotencyKey: key }),
    onSuccess: (order) => {
      setOrder(queryClient, order);
      void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
      toast(
        mode === 'MOVE'
          ? t('captain.transfer.moved', { from: table.label, to: targetLabel })
          : t('captain.transfer.merged', { from: table.label, to: targetLabel }),
      );
      onDone(order.id);
    },
    onError: (error) => {
      if (isApiError(error, 'TABLE_NOT_FREE') || isApiError(error, 'VERSION_CONFLICT')) {
        void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
      }
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!run.isPending}
      closeLabel={t('common.close')}
      title={
        mode === 'MOVE'
          ? t('captain.transfer.moveTitle', { label: table.label })
          : t('captain.transfer.mergeTitle', { label: table.label })
      }
      description={
        mode === 'MOVE' ? t('captain.transfer.moveHint') : t('captain.transfer.mergeHint')
      }
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={target === null || run.isPending}
            onClick={() => target !== null && run.mutate(target)}
          >
            {mode === 'MOVE' ? t('captain.transfer.move') : t('captain.transfer.merge')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {run.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(run.error)}
          </Alert>
        )}
        {candidates.length === 0 ? (
          <p className="text-muted-foreground">
            {mode === 'MOVE' ? t('captain.transfer.noFree') : t('captain.transfer.noOpen')}
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label={t('captain.transfer.target')}
            className="grid grid-cols-3 gap-2 sm:grid-cols-4"
          >
            {candidates.map((x) => (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={target === x.id}
                onClick={() => setTarget(x.id)}
                className={cn(
                  'min-h-touch rounded-lg border px-2 text-lg font-semibold',
                  target === x.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-surface hover:bg-muted',
                )}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
