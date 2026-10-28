import type { DiningTable } from '@restroos/contracts';
import { Alert, Button, cn, Dialog, Stepper } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { isApiError, newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { FLOOR_KEY } from '../../features/floor/floor-queries';
import { setOrder } from '../../features/orders/order-queries';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';

const QUICK = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const MAX_COVERS = 100;

/** "How many guests?" before a dine-in order starts on a free table. */
export function CoversDialog({ table, onClose }: { table: DiningTable; onClose: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [covers, setCovers] = useState(Math.min(table.seats, MAX_COVERS));
  // One key per dialog: a double tap or a retry after a lost reply opens one order, not two.
  const [key] = useState(newIdempotencyKey);

  const start = useMutation({
    mutationFn: () =>
      api.orders.open({ orderType: 'DINE_IN', tableId: table.id, covers }, { idempotencyKey: key }),
    onSuccess: (order) => {
      setOrder(queryClient, order);
      onClose();
      void navigate(`/captain/orders/${order.id}`);
    },
    onError: (error) => {
      if (isApiError(error, 'TABLE_NOT_FREE')) {
        void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
      }
    },
  });

  return (
    <CoversPicker
      title={t('order.covers.title', { label: table.label })}
      description={t('order.covers.description')}
      value={covers}
      onChange={setCovers}
      busy={start.isPending}
      error={start.isError ? errorMessage(start.error) : null}
      submitLabel={t('order.covers.start')}
      onSubmit={() => start.mutate()}
      onClose={onClose}
      formatNumber={format.number}
    />
  );
}

/** The guest-count picker, shared by "start order" and "change guests". */
export function CoversPicker({
  title,
  description,
  value,
  onChange,
  busy,
  error,
  submitLabel,
  onSubmit,
  onClose,
  formatNumber,
}: {
  title: string;
  description?: string;
  value: number;
  onChange: (covers: number) => void;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: () => void;
  onClose: () => void;
  formatNumber: (n: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      closeLabel={t('common.close')}
      title={title}
      {...(description === undefined ? {} : { description })}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={busy} data-autofocus>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <div
          role="radiogroup"
          aria-label={t('order.covers.label')}
          className="grid grid-cols-4 gap-2"
        >
          {QUICK.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              onClick={() => onChange(n)}
              className={cn(
                'min-h-touch rounded-lg border text-lg font-semibold tabular-nums',
                value === n
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-surface hover:bg-muted',
              )}
            >
              {formatNumber(n)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-medium">{t('order.covers.label')}</span>
          <Stepper
            value={value}
            onValueChange={onChange}
            min={1}
            max={MAX_COVERS}
            display={formatNumber(value)}
            decrementLabel={t('order.covers.fewer')}
            incrementLabel={t('order.covers.more')}
          />
        </div>
      </div>
    </Dialog>
  );
}
