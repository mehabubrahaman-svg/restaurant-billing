import type { DiningTable } from '@restroos/contracts';
import { Alert, Button, Dialog, Printer, QrCode, RefreshCw, Spinner } from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { QrImage } from '../../components/qr-image';
import { useErrorMessage } from '../../lib/errors';
import { retryUnlessClientError } from '../../lib/query';
import { useSession } from '../auth/auth-store';
import { toast } from '../toast/toast-store';
import { FLOOR_KEY, qrKey } from './floor-queries';

/**
 * The printable card: restaurant and branch name, table label, the QR and a
 * short instruction. Same component on screen and on the A4 sheet.
 */
export function QrCard({
  label,
  url,
  className,
}: {
  label: string;
  url: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const hub = useQuery({ queryKey: ['hub-info'], queryFn: api.hub.info, staleTime: Infinity });
  const restaurant = hub.data?.restaurantName;
  return (
    <figure
      className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-white p-4 text-center text-black break-inside-avoid ${className ?? ''}`}
    >
      <p className="flex flex-col text-base font-semibold">
        <span>{restaurant ?? session?.branch.name ?? t('app.name')}</span>
        {restaurant && session && (
          <span className="text-sm font-normal">{session.branch.name}</span>
        )}
      </p>
      <QrImage
        value={url}
        label={t('floor.qr.imageLabel', { label })}
        className="w-48 max-w-full"
      />
      <figcaption className="flex flex-col items-center gap-1">
        <span className="text-3xl font-bold">{t('floor.qr.tableLabel', { label })}</span>
        <span className="text-sm">{t('floor.qr.scanToOrder')}</span>
      </figcaption>
    </figure>
  );
}

/** View, create or rotate one table's QR code. */
export function TableQrDialog({ table, onClose }: { table: DiningTable; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const qr = useQuery({
    queryKey: qrKey(table.id),
    queryFn: () => api.floor.qr(table.id),
    retry: retryUnlessClientError,
  });
  const missing = isApiError(qr.error, 'NOT_FOUND');

  const rotate = useMutation({
    mutationFn: () => api.floor.rotateQr(table.id),
    onSuccess: (fresh) => {
      const hadQr = qr.data !== undefined;
      queryClient.setQueryData(qrKey(table.id), fresh);
      void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
      toast(
        !hadQr
          ? t('floor.qr.created', { label: table.label })
          : t('floor.qr.rotated', { label: table.label }),
      );
      setConfirmRotate(false);
    },
  });

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        dismissible={!rotate.isPending}
        closeLabel={t('common.close')}
        title={t('floor.qr.title', { label: table.label })}
        description={t('floor.qr.description')}
        footer={
          qr.data === undefined ? undefined : (
            <>
              <Button
                variant="outline"
                className="me-auto"
                onClick={() => setConfirmRotate(true)}
                disabled={rotate.isPending}
              >
                <RefreshCw aria-hidden="true" />
                {t('floor.qr.rotate')}
              </Button>
              <Button asChild>
                <Link to={`/admin/floor/print?tables=${table.id}`}>
                  <Printer aria-hidden="true" />
                  {t('floor.qr.print')}
                </Link>
              </Button>
            </>
          )
        }
      >
        {qr.isPending && <Spinner label={t('common.loading')} />}
        {missing && (
          <div className="flex flex-col items-start gap-3">
            <p>{t('floor.qr.none')}</p>
            <Button onClick={() => rotate.mutate()} disabled={rotate.isPending}>
              <QrCode aria-hidden="true" />
              {t('floor.qr.create')}
            </Button>
          </div>
        )}
        {qr.isError && !missing && (
          <Alert tone="danger" role="alert">
            {errorMessage(qr.error)}
          </Alert>
        )}
        {rotate.isError && !confirmRotate && (
          <Alert tone="danger" role="alert" className="mt-3">
            {errorMessage(rotate.error)}
          </Alert>
        )}
        {qr.data !== undefined && (
          <div className="flex flex-col items-center gap-3">
            <QrCard label={qr.data.label} url={qr.data.url} />
            <p className="text-center text-xs break-all text-muted-foreground">{qr.data.url}</p>
          </div>
        )}
      </Dialog>
      {confirmRotate && (
        <ConfirmDialog
          title={t('floor.qr.rotateTitle', { label: table.label })}
          body={t('floor.qr.rotateBody')}
          confirmLabel={t('floor.qr.rotate')}
          destructive
          busy={rotate.isPending}
          error={rotate.isError ? errorMessage(rotate.error) : null}
          onConfirm={() => rotate.mutate()}
          onClose={() => setConfirmRotate(false)}
        />
      )}
    </>
  );
}
