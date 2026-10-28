import type { DiningTable } from '@restroos/contracts';
import { Alert, ArrowLeft, Button, Printer, QrCode, Spinner } from '@restroos/ui';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { retryUnlessClientError } from '../../lib/query';
import { FLOOR_KEY, qrKey, useFloor } from './floor-queries';
import { QrCard } from './table-qr';

/**
 * /admin/floor/print?area=… (every table in an area) or ?tables=a,b (chosen
 * tables): QR cards laid out for A4, six to a page. The browser's print
 * dialog does the rest; the app chrome is hidden in print (print:hidden).
 */
export function QrPrintPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const floor = useFloor();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const areaId = params.get('area');
  const chosen = params.get('tables')?.split(',').filter(Boolean) ?? null;

  const areas = floor.data?.areas ?? [];
  const area = areas.find((a) => a.id === areaId) ?? null;
  const tables: DiningTable[] = areas
    .flatMap((a) => a.tables)
    .filter(
      (x) =>
        x.isActive &&
        (chosen !== null ? chosen.includes(x.id) : areaId === null || x.floorAreaId === areaId),
    )
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const withQr = tables.filter((x) => x.hasQr);
  const withoutQr = tables.filter((x) => !x.hasQr);

  const qrs = useQueries({
    queries: withQr.map((x) => ({
      queryKey: qrKey(x.id),
      queryFn: () => api.floor.qr(x.id),
      retry: retryUnlessClientError,
    })),
  });

  // Creating a QR for a table that has none is safe: nothing printed stops working.
  const createMissing = useMutation({
    mutationFn: async () => {
      for (const x of withoutQr)
        queryClient.setQueryData(qrKey(x.id), await api.floor.rotateQr(x.id));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: FLOOR_KEY }),
  });

  const loading = floor.isPending || qrs.some((q) => q.isPending);
  const failed = qrs.find((q) => q.isError);

  return (
    <div className="flex flex-col gap-4">
      <title>{`${t('floor.qr.sheetTitle')} · ${t('app.name')}`}</title>
      <div className="flex flex-col gap-3 print:hidden">
        <Link
          to="/admin/floor"
          className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('floor.backToFloor')}
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">{t('floor.qr.sheetTitle')}</h1>
            <p className="text-muted-foreground">
              {area !== null
                ? t('floor.qr.sheetArea', { area: area.name })
                : t('floor.qr.sheetHint')}
            </p>
          </div>
          <Button onClick={() => window.print()} disabled={loading || withQr.length === 0}>
            <Printer aria-hidden="true" />
            {t('floor.qr.printNow')}
          </Button>
        </header>
        {withoutQr.length > 0 && (
          <Alert tone="warning" title={t('floor.qr.missing', { count: withoutQr.length })}>
            <p>{withoutQr.map((x) => x.label).join(', ')}</p>
            <Button
              size="sm"
              className="mt-2"
              onClick={() => createMissing.mutate()}
              disabled={createMissing.isPending}
            >
              <QrCode aria-hidden="true" />
              {t('floor.qr.createMissing')}
            </Button>
            {createMissing.isError && <p className="mt-1">{errorMessage(createMissing.error)}</p>}
          </Alert>
        )}
        {failed !== undefined && (
          <Alert tone="danger" role="alert">
            {errorMessage(failed.error)}
          </Alert>
        )}
      </div>
      {loading ? (
        <Spinner label={t('common.loading')} />
      ) : withQr.length === 0 ? (
        <p className="text-muted-foreground print:hidden">{t('floor.qr.nothingToPrint')}</p>
      ) : (
        <div className="qr-sheet grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-[6mm]">
          {withQr.map((x, i) => {
            const qr = qrs[i]?.data;
            return qr === undefined ? null : (
              <QrCard
                key={x.id}
                label={qr.label}
                url={qr.url}
                className="print:h-[88mm] print:justify-center print:rounded-none"
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
