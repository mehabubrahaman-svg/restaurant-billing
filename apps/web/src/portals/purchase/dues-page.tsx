import type { VendorDuesReport } from '@restroos/contracts';
import { Alert, cn, Table, TBody, Td, Th, THead, Tr } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { useVendorDues } from '../../features/purchasing/purchasing-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { AsOfField, useReportParams } from '../accounts/date-range';
import { useMoney } from './purchase-ui';

const BUCKETS = ['current', 'd1to30', 'd31to60', 'd61to90', 'over90'] as const;
type Bucket = (typeof BUCKETS)[number];

/** /purchase/dues?asOf=: what is owed to each vendor, by how long past its due date. */
export function DuesPage() {
  const { t } = useTranslation();
  const { asOf, update } = useReportParams();
  const dues = useVendorDues(asOf);
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title={t('purchase.dues.title')} description={t('purchase.dues.description')} />
      <AsOfField value={asOf} allowFuture onChange={(v) => update({ asOf: v })} />
      <QueryState query={dues}>{(report) => <DuesTable report={report} />}</QueryState>
    </div>
  );
}

function DuesTable({ report }: { report: VendorDuesReport }) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  const cell = (value: number, bucket: Bucket | 'due' | 'advance') =>
    value === 0 ? (
      <span className="text-muted-foreground">{money(0)}</span>
    ) : (
      <span
        className={cn(
          bucket === 'due' && 'font-semibold',
          (bucket === 'd31to60' || bucket === 'd61to90' || bucket === 'over90') &&
            'font-semibold text-state-danger-fg',
          bucket === 'advance' && 'text-state-occupied-fg',
        )}
      >
        {money(value)}
      </span>
    );
  if (report.rows.length === 0) {
    return <Alert tone="success">{t('purchase.dues.nothing', { date: day(report.asOf) })}</Alert>;
  }
  return (
    <Table>
      <caption className="sr-only">
        {t('purchase.dues.caption', { date: day(report.asOf) })}
      </caption>
      <THead>
        <Tr>
          <Th>{t('purchase.dues.vendor')}</Th>
          {BUCKETS.map((b) => (
            <Th key={b} className="text-end">
              {t(`purchase.dues.buckets.${b}`)}
            </Th>
          ))}
          <Th className="text-end">{t('purchase.dues.due')}</Th>
          <Th className="text-end">{t('purchase.dues.advance')}</Th>
          <Th>{t('purchase.dues.oldest')}</Th>
        </Tr>
      </THead>
      <TBody>
        {report.rows.map((r) => (
          <Tr key={r.vendorId}>
            <Td>
              <Link
                to={`/purchase/vendors/${r.vendorId}`}
                className="font-medium break-words text-primary underline-offset-2 hover:underline"
              >
                {r.name}
              </Link>
              <span className="block font-mono text-xs text-muted-foreground">{r.code}</span>
            </Td>
            {BUCKETS.map((b) => (
              <Td key={b} className="text-end whitespace-nowrap tabular-nums">
                {cell(r[b], b)}
              </Td>
            ))}
            <Td className="text-end whitespace-nowrap tabular-nums">{cell(r.due, 'due')}</Td>
            <Td className="text-end whitespace-nowrap tabular-nums">
              {cell(r.advance, 'advance')}
            </Td>
            <Td className="whitespace-nowrap">
              {r.oldestDueOn === null ? t('reports.none') : day(r.oldestDueOn)}
            </Td>
          </Tr>
        ))}
      </TBody>
      <tfoot className="border-t-2 bg-muted font-semibold">
        <Tr>
          <Th scope="row">{t('purchase.dues.total')}</Th>
          {BUCKETS.map((b) => (
            <Td key={b} className="text-end whitespace-nowrap tabular-nums">
              {money(report.totals[b])}
            </Td>
          ))}
          <Td className="text-end whitespace-nowrap tabular-nums">{money(report.totals.due)}</Td>
          <Td className="text-end whitespace-nowrap tabular-nums">
            {money(report.totals.advance)}
          </Td>
          <Td />
        </Tr>
      </tfoot>
    </Table>
  );
}
