import type { MenuImportResponse } from '@restroos/contracts';
import {
  Alert,
  Button,
  Card,
  CircleCheck,
  Download,
  Field,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  Upload,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/endpoints';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { AdminHeader } from '../admin/admin-layout';
import { MENU_CSV_COLUMNS, menuCsvTemplate } from './csv-template';
import { invalidateMenu } from './menu-queries';

const MAX_CSV_CHARS = 2_000_000;

/** Admin → Menu → Import: upload or paste a CSV, check it (dry run), then import. */
export function ImportPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);
  // The dry run is only valid for the exact text it checked.
  const [checked, setChecked] = useState<{ csv: string; result: MenuImportResponse } | null>(null);
  const [imported, setImported] = useState<MenuImportResponse | null>(null);

  const check = useMutation({
    mutationFn: (text: string) =>
      api.menu.import(text, true).then((result) => ({ csv: text, result })),
    onSuccess: (r) => {
      setChecked(r);
      setImported(null);
    },
  });
  const run = useMutation({
    mutationFn: (text: string) => api.menu.import(text, false),
    onSuccess: (result) => {
      setImported(result);
      setChecked(null);
      void invalidateMenu(queryClient);
    },
  });

  function takeText(text: string, name: string | null) {
    setTooBig(text.length > MAX_CSV_CHARS);
    setCsv(text);
    setFileName(name);
    setImported(null);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    // Excel saves "CSV UTF-8" with a byte-order mark; the Hub does not need it.
    takeText((await file.text()).replace(/^\uFEFF/, ''), file.name);
    event.target.value = '';
  }

  function downloadTemplate() {
    const blob = new Blob([`\uFEFF${menuCsvTemplate()}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'restroos-menu-template.csv';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const current = checked !== null && checked.csv === csv ? checked.result : null;
  const canImport = current !== null && current.errors.length === 0 && current.rows > 0;
  const n = (v: number) => format.number(v);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('menu.import.title')}
        description={t('menu.import.description')}
        actions={
          <Button variant="outline" onClick={downloadTemplate}>
            <Download aria-hidden="true" />
            {t('menu.import.template')}
          </Button>
        }
      />

      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="text-lg font-semibold">{t('menu.import.step1')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void onFile(e)}
          />
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            <Upload aria-hidden="true" />
            {t('menu.import.upload')}
          </Button>
          {fileName !== null && (
            <span className="text-sm break-all text-muted-foreground">
              {t('menu.import.fileChosen', { name: fileName })}
            </span>
          )}
        </div>
        <Field
          label={t('menu.import.paste')}
          hint={t('menu.import.pasteHint')}
          error={tooBig ? t('menu.import.tooBig') : undefined}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={8}
              spellCheck={false}
              className="font-mono text-sm"
              value={csv}
              onChange={(e) => takeText(e.target.value, null)}
            />
          )}
        </Field>
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t('menu.import.columnsTitle')}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {MENU_CSV_COLUMNS.map((column) => (
              <li key={column}>
                <code className="font-mono font-semibold">{column}</code>
                {' — '}
                {t(`menu.import.columns.${column}`)}
              </li>
            ))}
          </ul>
        </details>
        <Button
          className="self-start"
          disabled={csv.trim() === '' || tooBig || check.isPending}
          onClick={() => check.mutate(csv)}
        >
          {check.isPending ? t('menu.import.checking') : t('menu.import.check')}
        </Button>
        {check.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(check.error)}
          </Alert>
        )}
      </Card>

      {current !== null && (
        <Card className="flex flex-col gap-4 p-4 md:p-5" aria-live="polite">
          <h2 className="text-lg font-semibold">{t('menu.import.step2')}</h2>
          <ImportSummary result={current} />
          {current.errors.length > 0 ? (
            <>
              <Alert
                tone="danger"
                title={t('menu.import.hasErrors', { count: current.errors.length })}
              >
                {t('menu.import.fixAndRecheck')}
              </Alert>
              <Table aria-label={t('menu.import.errorsTable')}>
                <THead>
                  <Tr>
                    <Th>{t('menu.import.row')}</Th>
                    <Th>{t('menu.import.column')}</Th>
                    <Th>{t('menu.import.problem')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {current.errors.map((e, i) => (
                    <Tr key={i} className="bg-state-danger-soft">
                      <Td className="tabular-nums">{n(e.row)}</Td>
                      <Td>
                        {e.column === undefined ? (
                          '—'
                        ) : (
                          <code className="font-mono">{e.column}</code>
                        )}
                      </Td>
                      <Td lang="en">{e.message}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </>
          ) : (
            <Alert tone="success">{t('menu.import.noErrors')}</Alert>
          )}
          {run.isError && (
            <Alert tone="danger" role="alert">
              {errorMessage(run.error)}
            </Alert>
          )}
          <Button
            className="self-start"
            disabled={!canImport || run.isPending}
            onClick={() => run.mutate(csv)}
          >
            {run.isPending
              ? t('menu.import.importing')
              : t('menu.import.import', { count: current.created + current.updated })}
          </Button>
        </Card>
      )}

      {imported !== null && (
        <Alert tone="success" role="status" title={t('menu.import.done')}>
          <ImportSummary result={imported} />
          <Link to="/admin/menu" className="mt-2 inline-block font-medium underline">
            {t('menu.backToMenu')}
          </Link>
        </Alert>
      )}
    </div>
  );
}

function ImportSummary({ result }: { result: MenuImportResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  const rows: [string, string][] = [
    [t('menu.import.rows'), format.number(result.rows)],
    [
      result.dryRun ? t('menu.import.willCreate') : t('menu.import.created'),
      format.number(result.created),
    ],
    [
      result.dryRun ? t('menu.import.willUpdate') : t('menu.import.updated'),
      format.number(result.updated),
    ],
  ];
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_auto] justify-start gap-x-6 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {result.createdCategories.length > 0 && (
        <p className="flex items-start gap-2 text-sm">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('menu.import.newCategories', { names: result.createdCategories.join(', ') })}
        </p>
      )}
      {result.createdStations.length > 0 && (
        <p className="flex items-start gap-2 text-sm">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('menu.import.newStations', { names: result.createdStations.join(', ') })}
        </p>
      )}
    </div>
  );
}
