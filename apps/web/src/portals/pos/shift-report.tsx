import type { ShiftReport } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { cn, Table, TBody, Td, Th, THead, Tr } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../i18n/use-format';

/** A tender's variance as text and colour: "Matches" (green), "Short ₹20.00" / "Over ₹5.00" (red). */
export function Variance({ value }: { value: number | null }) {
  const { t } = useTranslation();
  const format = useFormat();
  if (value === null)
    return <span className="text-muted-foreground">{t('pos.shift.notCounted')}</span>;
  const amount = format.money(Money.ofPaise(Math.abs(value)));
  return (
    <span
      data-variance={value === 0 ? 'match' : value < 0 ? 'short' : 'over'}
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-sm font-semibold whitespace-nowrap',
        value === 0
          ? 'bg-state-available-soft text-state-available-fg'
          : 'bg-state-danger-soft text-state-danger-fg',
      )}
    >
      {value === 0
        ? t('pos.shift.matches')
        : value < 0
          ? t('pos.shift.short', { amount })
          : t('pos.shift.over', { amount })}
    </span>
  );
}

/** X report (shift open) or Z report (closed): totals and expected vs reported per tender. */
export function ShiftReportView({ report }: { report: ShiftReport }) {
  const { t } = useTranslation();
  const format = useFormat();
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const closed = report.status === 'CLOSED';
  const facts: [string, string][] = [
    [t('pos.shift.openedAt'), `${format.dateTime(report.openedAt)} · ${report.openedByName ?? ''}`],
    ...(closed && report.closedAt !== null
      ? [
          [
            t('pos.shift.closedAt'),
            `${format.dateTime(report.closedAt)} · ${report.closedByName ?? ''}`,
          ] as [string, string],
        ]
      : []),
    [t('pos.shift.float'), money(report.openingFloat)],
    [t('pos.shift.invoices'), format.number(report.invoiceCount)],
    [t('pos.shift.sales'), money(report.sales)],
    [t('pos.shift.refunds'), money(report.refunds)],
    [t('pos.shift.expectedCash'), money(report.expectedCash)],
    ...(report.countedCash === null
      ? []
      : [[t('pos.shift.countedCash'), money(report.countedCash)] as [string, string]]),
  ];
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">
        {closed ? t('pos.shift.zTitle') : t('pos.shift.xTitle')}
      </h2>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b py-1">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-end font-medium tabular-nums">{value}</dd>
          </div>
        ))}
        {report.cashVariance !== null && (
          <div className="flex justify-between gap-3 border-b py-1">
            <dt className="text-muted-foreground">{t('pos.shift.cashVariance')}</dt>
            <dd>
              <Variance value={report.cashVariance} />
            </dd>
          </div>
        )}
      </dl>
      <Table>
        <caption className="sr-only">{t('pos.shift.tenders')}</caption>
        <THead>
          <Tr>
            <Th>{t('pos.shift.tender')}</Th>
            <Th className="text-end">{t('pos.shift.expected')}</Th>
            <Th className="text-end">{t('pos.shift.reported')}</Th>
            <Th>{t('pos.shift.variance')}</Th>
          </Tr>
        </THead>
        <TBody>
          {report.tenders.length === 0 && (
            <Tr>
              <Td colSpan={4} className="text-muted-foreground">
                {t('pos.shift.noTenders')}
              </Td>
            </Tr>
          )}
          {report.tenders.map((line) => (
            <Tr key={`${line.method}|${line.terminalLabel}`}>
              <Td>
                {t(`pos.tenders.${line.method}`)}
                {line.terminalLabel !== '' && (
                  <span className="ms-1 text-muted-foreground">· {line.terminalLabel}</span>
                )}
              </Td>
              <Td className="text-end tabular-nums">{money(line.expected)}</Td>
              <Td className="text-end tabular-nums">
                {line.reported === null ? '—' : money(line.reported)}
              </Td>
              <Td>
                <Variance value={line.variance} />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
