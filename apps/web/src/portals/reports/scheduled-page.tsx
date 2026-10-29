import type { ReportFile, ReportSchedule, ScheduledReport } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Button,
  Download,
  Field,
  Play,
  Plus,
  Select,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import {
  REPORT_KEYS,
  useDownload,
  useReportFiles,
  useReportSchedules,
} from '../../features/reports/report-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { sizeParts } from '../../lib/download';
import { useErrorMessage } from '../../lib/errors';

type Frequency = ReportSchedule['frequency'];
type Format = ReportSchedule['format'];
const REPORTS: readonly ScheduledReport[] = [
  'SALES',
  'SALES_REGISTER',
  'DAY_END',
  'GSTR1',
  'GSTR3B',
  'VAT_REGISTER',
];
const FINANCIAL = new Set<ScheduledReport>(['GSTR1', 'GSTR3B', 'VAT_REGISTER']);
const FREQUENCIES: readonly Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
const FORMATS: readonly Format[] = ['XLSX', 'CSV'];

/** The day-end report is one business day, as a CSV. */
const frequenciesFor = (report: ScheduledReport) =>
  report === 'DAY_END' ? (['DAILY'] as const) : FREQUENCIES;
const formatsFor = (report: ScheduledReport) =>
  report === 'DAY_END' ? (['CSV'] as const) : FORMATS;

/** "28 Oct 2026" or "1 Sept 2026 – 30 Sept 2026". */
function usePeriod() {
  const day = useDayFormat();
  return (from: string, to: string) => (from === to ? day(from) : `${day(from)} – ${day(to)}`);
}

/** /reports/scheduled: reports the Hub makes by itself, and the files it kept. */
export function ScheduledPage() {
  const { t } = useTranslation();
  const schedules = useReportSchedules();
  const files = useReportFiles();

  return (
    <div className="flex flex-col gap-6">
      <title>{`${t('reports.scheduled.title')} · ${t('app.name')}`}</title>
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('reports.scheduled.title')}</h1>
        <p className="text-muted-foreground">{t('reports.scheduled.description')}</p>
      </header>
      <AddSchedule />
      <section aria-labelledby="sched-list" className="flex flex-col gap-2">
        <h2 id="sched-list" className="font-semibold">
          {t('reports.scheduled.schedules')}
        </h2>
        <QueryState query={schedules}>
          {({ data }) =>
            data.length === 0 ? (
              <p className="text-muted-foreground">{t('reports.scheduled.noSchedules')}</p>
            ) : (
              <ScheduleTable schedules={data} />
            )
          }
        </QueryState>
      </section>
      <section aria-labelledby="sched-files" className="flex flex-col gap-2">
        <h2 id="sched-files" className="font-semibold">
          {t('reports.scheduled.files')}
        </h2>
        <QueryState query={files}>
          {({ data }) =>
            data.length === 0 ? (
              <p className="text-muted-foreground">{t('reports.scheduled.noFiles')}</p>
            ) : (
              <FileTable files={data} />
            )
          }
        </QueryState>
      </section>
    </div>
  );
}

function AddSchedule() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canFinancial = usePermission('reports.financial');
  const reports = REPORTS.filter((r) => canFinancial || !FINANCIAL.has(r));
  const [report, setReport] = useState<ScheduledReport>('SALES');
  const [frequency, setFrequency] = useState<Frequency>('DAILY');
  const [format, setFormat] = useState<Format>('XLSX');
  const add = useMutation({
    mutationFn: () => api.reportSchedules.create({ report, frequency, format }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: REPORT_KEYS.schedules });
      toast(
        t('reports.scheduled.added', {
          report: t(`reports.scheduled.reports.${saved.report}`),
          frequency: t(`reports.scheduled.frequencies.${saved.frequency}`),
        }),
      );
    },
  });
  const choose = (next: ScheduledReport) => {
    setReport(next);
    if (!(frequenciesFor(next) as readonly Frequency[]).includes(frequency)) setFrequency('DAILY');
    if (!(formatsFor(next) as readonly Format[]).includes(format)) setFormat('CSV');
  };

  return (
    <section aria-labelledby="sched-add" className="flex flex-col gap-2">
      <h2 id="sched-add" className="font-semibold">
        {t('reports.scheduled.add')}
      </h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label={t('reports.scheduled.report')}>
          {(p) => (
            <Select
              {...p}
              value={report}
              onChange={(e) => choose(e.target.value as ScheduledReport)}
            >
              {reports.map((r) => (
                <option key={r} value={r}>
                  {t(`reports.scheduled.reports.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('reports.scheduled.frequency')}>
          {(p) => (
            <Select
              {...p}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {frequenciesFor(report).map((f) => (
                <option key={f} value={f}>
                  {t(`reports.scheduled.frequencies.${f}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('reports.scheduled.format')}>
          {(p) => (
            <Select {...p} value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              {formatsFor(report).map((f) => (
                <option key={f} value={f}>
                  {f === 'XLSX' ? t('reports.export.excel') : t('reports.export.csv')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" disabled={add.isPending}>
          <Plus aria-hidden="true" />
          {t('reports.scheduled.addButton')}
        </Button>
      </form>
      {add.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(add.error)}
        </Alert>
      )}
    </section>
  );
}

function ScheduleTable({ schedules }: { schedules: ReportSchedule[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const day = useDayFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: REPORT_KEYS.schedules });
    void queryClient.invalidateQueries({ queryKey: REPORT_KEYS.files });
  };
  const toggle = useMutation({
    mutationFn: (s: ReportSchedule) =>
      api.reportSchedules.update(s.id, { isActive: !s.isActive, version: s.version }),
    onSuccess: refresh,
    onError: (error) => toast(errorMessage(error), 'danger'),
  });
  const run = useMutation({
    mutationFn: (s: ReportSchedule) => api.reportSchedules.run(s.id),
    onSuccess: (file) => {
      refresh();
      toast(t('reports.scheduled.made', { name: file.fileName }));
    },
    onError: (error) => toast(errorMessage(error), 'danger'),
  });

  return (
    <Table aria-label={t('reports.scheduled.schedules')}>
      <THead>
        <Tr>
          <Th>{t('reports.scheduled.report')}</Th>
          <Th>{t('reports.scheduled.frequency')}</Th>
          <Th>{t('reports.scheduled.format')}</Th>
          <Th>{t('reports.scheduled.lastMade')}</Th>
          <Th>{t('reports.scheduled.active')}</Th>
          <Th>
            <span className="sr-only">{t('reports.scheduled.actions')}</span>
          </Th>
        </Tr>
      </THead>
      <TBody>
        {schedules.map((s) => {
          const name = t(`reports.scheduled.reports.${s.report}`);
          return (
            <Tr key={s.id} className={s.isActive ? undefined : 'text-muted-foreground'}>
              <Td className="font-medium">{name}</Td>
              <Td>{t(`reports.scheduled.frequencies.${s.frequency}`)}</Td>
              <Td>{s.format === 'XLSX' ? t('reports.export.excel') : t('reports.export.csv')}</Td>
              <Td>
                {s.lastPeriodTo === null ? (
                  <span className="text-muted-foreground">{t('reports.scheduled.notYet')}</span>
                ) : (
                  <span className="flex flex-col">
                    <span>{t('reports.scheduled.upTo', { date: day(s.lastPeriodTo) })}</span>
                    {s.lastRunAt !== null && (
                      <span className="text-xs text-muted-foreground">
                        {format.dateTime(s.lastRunAt, { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    )}
                  </span>
                )}
                {s.lastError !== null && (
                  <Badge variant="danger" className="mt-1" title={s.lastError}>
                    {t('reports.scheduled.failed')}
                  </Badge>
                )}
              </Td>
              <Td>
                <Switch
                  label={
                    <span className="sr-only">
                      {t('reports.scheduled.activeNamed', { report: name })}
                    </span>
                  }
                  checked={s.isActive}
                  disabled={toggle.isPending}
                  onCheckedChange={() => toggle.mutate(s)}
                />
              </Td>
              <Td className="text-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={run.isPending}
                  aria-label={t('reports.scheduled.runNamed', { report: name })}
                  onClick={() => run.mutate(s)}
                >
                  <Play aria-hidden="true" />
                  {t('reports.scheduled.run')}
                </Button>
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

function FileTable({ files }: { files: ReportFile[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const period = usePeriod();
  const download = useDownload(
    (file: ReportFile) => api.reportFiles.download(file.id),
    (file) => file.fileName,
  );
  const size = (bytes: number) => {
    const { value, unit } = sizeParts(bytes);
    return t('backups.size', { value: format.number(value), unit });
  };

  return (
    <Table aria-label={t('reports.scheduled.files')}>
      <THead>
        <Tr>
          <Th>{t('reports.scheduled.report')}</Th>
          <Th>{t('reports.scheduled.period')}</Th>
          <Th>{t('reports.scheduled.madeAt')}</Th>
          <Th className="text-end">{t('reports.scheduled.size')}</Th>
          <Th>
            <span className="sr-only">{t('reports.scheduled.actions')}</span>
          </Th>
        </Tr>
      </THead>
      <TBody>
        {files.map((f) => (
          <Tr key={f.id}>
            <Td>
              <span className="font-medium">{t(`reports.scheduled.reports.${f.report}`)}</span>
              <span className="block font-mono text-xs break-all text-muted-foreground">
                {f.fileName}
              </span>
            </Td>
            <Td className="whitespace-nowrap">{period(f.periodFrom, f.periodTo)}</Td>
            <Td className="whitespace-nowrap">
              {format.dateTime(f.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
              {f.createdBy === null && (
                <span className="block text-xs text-muted-foreground">
                  {t('reports.scheduled.bySchedule')}
                </span>
              )}
            </Td>
            <Td className="text-end whitespace-nowrap tabular-nums">{size(f.sizeBytes)}</Td>
            <Td className="text-end">
              <Button
                size="sm"
                variant="outline"
                disabled={download.isPending}
                aria-label={t('reports.scheduled.downloadNamed', { name: f.fileName })}
                onClick={() => download.mutate(f)}
              >
                <Download aria-hidden="true" />
                {t('reports.scheduled.download')}
              </Button>
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
