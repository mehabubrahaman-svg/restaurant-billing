import type { Gstr1, Gstr3b, VatRegister } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Button,
  Card,
  Download,
  Field,
  FileSpreadsheet,
  Input,
  Printer,
  SegmentedControl,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { api } from '../../api/endpoints';
import { QueryState } from '../../features/admin/query-state';
import { useDownload } from '../../features/reports/report-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { useFormat } from '../../i18n/use-format';
import { localIsoDate } from '../pos/bills-page';

type ReturnKind = 'gstr1' | 'gstr3b' | 'vat';
const KINDS: readonly ReturnKind[] = ['gstr1', 'gstr3b', 'vat'];
const GSTR1_SECTIONS = [
  'b2b',
  'b2cl',
  'b2cs',
  'cdnr',
  'cdnur',
  'exemp',
  'hsn(b2b)',
  'hsn(b2c)',
  'docs',
  'eco',
];

/** The first and last day of a month written YYYY-MM. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** The month before today's: the return usually being filed. */
function lastMonth(today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** /reports/gst?month=&return=: GSTR-1, GSTR-3B and the liquor VAT register for a month. */
export function GstPage() {
  const { t } = useTranslation();
  const day = useDayFormat();
  const [params, setParams] = useSearchParams();
  const today = localIsoDate();
  const monthParam = params.get('month');
  const month =
    monthParam !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)
      ? monthParam
      : lastMonth(today);
  const kind = KINDS.find((k) => k === params.get('return')) ?? 'gstr1';
  const { from, to } = monthRange(month);
  const set = (patch: Record<string, string>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [k, v] of Object.entries(patch)) next.set(k, v);
        return next;
      },
      { replace: true },
    );
  const name = kind === 'vat' ? 'vat-register' : kind;
  const download = useDownload(
    ({ file, format }: { file: string; format: 'xlsx' | 'csv' }) =>
      api.reports.returnFile(file, format, from, to),
    ({ file, format }) => `${file.replace('/', '-')}-${from}-to-${to}.${format}`,
  );

  return (
    <div className="flex flex-col gap-4">
      <title>{`${t('reports.gst.title')} · ${t('app.name')}`}</title>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold">{t('reports.gst.title')}</h1>
          <p className="text-muted-foreground">{t('reports.gst.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            variant="outline"
            disabled={download.isPending}
            onClick={() => download.mutate({ file: name, format: 'xlsx' })}
          >
            <FileSpreadsheet aria-hidden="true" />
            {t('reports.export.excel')}
          </Button>
          <Button
            variant="outline"
            disabled={download.isPending}
            onClick={() => download.mutate({ file: name, format: 'csv' })}
          >
            <Download aria-hidden="true" />
            {t('reports.export.csv')}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            {t('reports.export.print')}
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label={t('reports.gst.month')} className="w-full sm:w-48">
          {(p) => (
            <Input
              {...p}
              type="month"
              value={month}
              max={today.slice(0, 7)}
              onChange={(e) => {
                if (e.target.value !== '') set({ month: e.target.value });
              }}
            />
          )}
        </Field>
        <SegmentedControl<ReturnKind>
          aria-label={t('reports.gst.return')}
          value={kind}
          onValueChange={(k) => set({ return: k })}
          options={KINDS.map((k) => ({ value: k, label: t(`reports.gst.kinds.${k}`) }))}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t('reports.gst.period', { from: day(from), to: day(to) })}
      </p>
      {kind === 'gstr1' && (
        <Gstr1View
          from={from}
          to={to}
          onSection={(section) => download.mutate({ file: `gstr1/${section}`, format: 'csv' })}
        />
      )}
      {kind === 'gstr3b' && <Gstr3bView from={from} to={to} />}
      {kind === 'vat' && <VatView from={from} to={to} />}
    </div>
  );
}

function useMoney() {
  const format = useFormat();
  return (paise: number) => format.money(Money.ofPaise(paise));
}

function Gstr1View({
  from,
  to,
  onSection,
}: {
  from: string;
  to: string;
  onSection: (section: string) => void;
}) {
  const query = useQuery({
    queryKey: ['reports', 'gstr1', from, to],
    queryFn: () => api.reports.gstr1(from, to),
  });
  return <QueryState query={query}>{(r) => <Gstr1Body r={r} onSection={onSection} />}</QueryState>;
}

function Gstr1Body({ r, onSection }: { r: Gstr1; onSection: (section: string) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const format = useFormat();
  const day = useDayFormat();
  const pct = (bp: number) =>
    format.number(bp / 10_000, { style: 'percent', maximumFractionDigits: 2 });
  const pos = (code: string) => `${code} ${r.stateNames[code] ?? ''}`.trim();
  const sum = (rows: readonly { taxable: number }[]) => rows.reduce((n, x) => n + x.taxable, 0);
  const counts: [string, string, string][] = [
    ['b2b', t('reports.gst.sections.b2b'), format.number(r.b2b.length)],
    ['b2cs', t('reports.gst.sections.b2cs'), money(sum(r.b2cs))],
    ['cdnr', t('reports.gst.sections.cdnr'), format.number(r.cdnr.length)],
    ['eco', t('reports.gst.sections.eco'), money(r.eco.reduce((n, e) => n + e.taxable, 0))],
  ];
  return (
    <div className="flex flex-col gap-4">
      {r.gstin === null && <Alert tone="warning">{t('reports.gst.noGstin')}</Alert>}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counts.map(([key, label, value]) => (
          <li key={key}>
            <Card className="flex h-full flex-col gap-1 p-3">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="text-lg font-bold tabular-nums">{value}</span>
            </Card>
          </li>
        ))}
      </ul>
      <Block
        title={t('reports.gst.sections.b2b')}
        head={[
          t('reports.gst.gstin'),
          t('reports.gst.invoice'),
          t('reports.gst.rate'),
          t('reports.gst.taxable'),
          t('reports.gst.tax'),
        ]}
        rows={r.b2b.map((b) => [
          `${b.gstin}${b.receiverName ? ` · ${b.receiverName}` : ''}`,
          `${b.invoiceNo} · ${day(b.invoiceDate)}`,
          pct(b.rateBp),
          money(b.taxable),
          money(b.igst + b.cgst + b.sgst + b.cess),
        ])}
        onCsv={() => onSection('b2b')}
      />
      <Block
        title={t('reports.gst.sections.b2cs')}
        head={[
          t('reports.gst.place'),
          t('reports.gst.rate'),
          t('reports.gst.taxable'),
          t('reports.gst.tax'),
        ]}
        rows={r.b2cs.map((b) => [
          pos(b.placeOfSupply),
          pct(b.rateBp),
          money(b.taxable),
          money(b.igst + b.cgst + b.sgst + b.cess),
        ])}
        onCsv={() => onSection('b2cs')}
      />
      {r.b2cl.length > 0 && (
        <Block
          title={t('reports.gst.sections.b2cl')}
          head={[
            t('reports.gst.invoice'),
            t('reports.gst.place'),
            t('reports.gst.rate'),
            t('reports.gst.taxable'),
          ]}
          rows={r.b2cl.map((b) => [
            b.invoiceNo,
            pos(b.placeOfSupply),
            pct(b.rateBp),
            money(b.taxable),
          ])}
          onCsv={() => onSection('b2cl')}
        />
      )}
      <Block
        title={t('reports.gst.sections.cdnr')}
        head={[
          t('reports.gst.gstin'),
          t('reports.gst.note'),
          t('reports.gst.against'),
          t('reports.gst.taxable'),
          t('reports.gst.tax'),
        ]}
        rows={r.cdnr.map((c) => [
          c.gstin,
          `${c.noteNo} · ${day(c.noteDate)}`,
          c.originalInvoiceNo ?? t('reports.none'),
          money(c.taxable),
          money(c.igst + c.cgst + c.sgst + c.cess),
        ])}
        onCsv={() => onSection('cdnr')}
      />
      {r.cdnur.length > 0 && (
        <Block
          title={t('reports.gst.sections.cdnur')}
          head={[t('reports.gst.note'), t('reports.gst.against'), t('reports.gst.taxable')]}
          rows={r.cdnur.map((c) => [
            c.noteNo,
            c.originalInvoiceNo ?? t('reports.none'),
            money(c.taxable),
          ])}
          onCsv={() => onSection('cdnur')}
        />
      )}
      <Block
        title={t('reports.gst.sections.exemp')}
        head={[
          t('reports.gst.supplies'),
          t('reports.gst.nil'),
          t('reports.gst.exempted'),
          t('reports.gst.nonGst'),
        ]}
        rows={r.exempt.map((e) => [
          t(`reports.gst.exemptKinds.${e.kind}`),
          money(e.nilRated),
          money(e.exempted),
          money(e.nonGst),
        ])}
        onCsv={() => onSection('exemp')}
      />
      {(['b2c', 'b2b'] as const).map((side) => (
        <Block
          key={side}
          title={t(`reports.gst.sections.hsn_${side}`)}
          head={[
            t('reports.gst.hsn'),
            t('reports.gst.rate'),
            t('reports.quantity'),
            t('reports.gst.taxable'),
            t('reports.gst.tax'),
          ]}
          rows={r.hsn[side].map((h) => [
            `${h.hsn} · ${h.description}`,
            pct(h.rateBp),
            h.uqc === 'NA' ? t('reports.none') : format.number(h.quantity),
            money(h.taxable),
            money(h.igst + h.cgst + h.sgst + h.cess),
          ])}
          onCsv={() => onSection(`hsn(${side})`)}
        />
      ))}
      <Block
        title={t('reports.gst.sections.docs')}
        head={[
          t('reports.gst.series'),
          t('reports.gst.fromNo'),
          t('reports.gst.toNo'),
          t('reports.gst.total'),
          t('reports.gst.cancelled'),
        ]}
        rows={r.docs.map((d) => [
          `${t(`reports.gst.natures.${d.nature}`)} · ${d.series}`,
          d.fromNo,
          d.toNo,
          format.number(d.total),
          format.number(d.cancelled),
        ])}
        onCsv={() => onSection('docs')}
      />
      <Block
        title={t('reports.gst.sections.eco')}
        head={[t('reports.gst.operator'), t('reports.gst.gstin'), t('reports.gst.taxable')]}
        rows={r.eco.map((e) => [
          e.operator,
          e.operatorGstin ?? t('reports.gst.gstinMissing'),
          money(e.taxable),
        ])}
        onCsv={() => onSection('eco')}
      />
      <p className="text-sm text-muted-foreground">
        {t('reports.gst.sectionsHint', { sections: GSTR1_SECTIONS.join(', ') })}
      </p>
    </div>
  );
}

function Gstr3bView({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ['reports', 'gstr3b', from, to],
    queryFn: () => api.reports.gstr3b(from, to),
  });
  return <QueryState query={query}>{(r) => <Gstr3bBody r={r} />}</QueryState>;
}

function Gstr3bBody({ r }: { r: Gstr3b }) {
  const { t } = useTranslation();
  const money = useMoney();
  const heads = (h: { igst: number; cgst: number; sgst: number; cess: number }) => [
    money(h.igst),
    money(h.cgst),
    money(h.sgst),
    money(h.cess),
  ];
  const none = ['', '', '', ''];
  const rows: string[][] = [
    [
      '3.1(a)',
      t('reports.gst.3b.taxable'),
      money(r.outward.taxable.taxable),
      ...heads(r.outward.taxable),
    ],
    [
      '3.1(b)',
      t('reports.gst.3b.zeroRated'),
      money(r.outward.zeroRated.taxable),
      ...heads(r.outward.zeroRated),
    ],
    ['3.1(c)', t('reports.gst.3b.nilExempt'), money(r.outward.nilExempt), ...none],
    [
      '3.1(d)',
      t('reports.gst.3b.reverseCharge'),
      money(r.outward.reverseCharge.taxable),
      ...heads(r.outward.reverseCharge),
    ],
    ['3.1(e)', t('reports.gst.3b.nonGst'), money(r.outward.nonGst), ...none],
    ['3.1.1', t('reports.gst.3b.eco'), money(r.ecoSupplies), ...none],
    ...r.interStateUnregistered.map((s) => [
      '3.2',
      t('reports.gst.3b.interState', {
        place: `${s.placeOfSupply} ${r.stateNames[s.placeOfSupply] ?? ''}`.trim(),
      }),
      money(s.taxable),
      money(s.igst),
      '',
      '',
      '',
    ]),
    ['4(A)(5)', t('reports.gst.3b.itc'), '', ...heads(r.itc.available)],
    [
      '5',
      t('reports.gst.3b.inward'),
      money(r.inwardNonGst.interState + r.inwardNonGst.intraState),
      ...none,
    ],
    ['6.1', t('reports.gst.3b.payable'), '', ...heads(r.payable)],
    ['', t('reports.gst.3b.carried'), '', ...heads(r.creditCarriedForward)],
  ];
  return (
    <div className="flex flex-col gap-3">
      {!r.itc.allowed && <Alert tone="info">{t('reports.gst.3b.noItc')}</Alert>}
      <Table>
        <THead>
          <Tr>
            <Th>{t('reports.gst.3b.table')}</Th>
            <Th>{t('reports.gst.3b.nature')}</Th>
            <Th className="text-end">{t('reports.gst.taxable')}</Th>
            <Th className="text-end">IGST</Th>
            <Th className="text-end">CGST</Th>
            <Th className="text-end">SGST</Th>
            <Th className="text-end">{t('reports.gst.cess')}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((row, i) => (
            <Tr key={i}>
              {row.map((cell, j) => (
                <Td
                  key={j}
                  className={j < 2 ? 'break-words' : 'text-end whitespace-nowrap tabular-nums'}
                >
                  {cell}
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function VatView({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ['reports', 'vat-register', from, to],
    queryFn: () => api.reports.vatRegister(from, to),
  });
  return <QueryState query={query}>{(r) => <VatBody r={r} />}</QueryState>;
}

function VatBody({ r }: { r: VatRegister }) {
  const { t } = useTranslation();
  const money = useMoney();
  const format = useFormat();
  const day = useDayFormat();
  const pct = (bp: number) =>
    format.number(bp / 10_000, { style: 'percent', maximumFractionDigits: 2 });
  return (
    <div className="flex flex-col gap-4">
      <Block
        title={t('reports.gst.vat.byRate')}
        head={[
          t('reports.gst.rate'),
          t('reports.dashboard.invoices'),
          t('reports.gst.taxable'),
          t('reports.gst.vat.vat'),
          t('reports.gst.vat.surcharge'),
          t('reports.gst.total'),
        ]}
        rows={r.byRate.map((x) => [
          pct(x.rateBp),
          format.number(x.bills),
          money(x.taxable),
          money(x.vat),
          money(x.surcharge),
          money(x.total),
        ])}
      />
      <Block
        title={t('reports.gst.vat.bills')}
        head={[
          t('reports.gst.invoice'),
          t('reports.gst.rate'),
          t('reports.gst.taxable'),
          t('reports.gst.vat.vat'),
          t('reports.gst.total'),
        ]}
        rows={r.rows.map((x) => [
          `${x.invoiceNo} · ${day(x.date)}${x.kind === 'CREDIT_NOTE' ? ` · ${t('reports.gst.natures.CREDIT_NOTE')}` : ''}`,
          pct(x.rateBp),
          money(x.taxable),
          money(x.vat),
          money(x.total),
        ])}
      />
    </div>
  );
}

/** A titled table with its own CSV download (GSTR-1 sections for the offline tool). */
function Block({
  title,
  head,
  rows,
  onCsv,
}: {
  title: string;
  head: readonly string[];
  rows: readonly (readonly string[])[];
  onCsv?: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <section className="flex min-w-0 flex-col gap-2 break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {onCsv !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            className="print:hidden"
            onClick={onCsv}
            aria-label={t('reports.gst.sectionCsv', { section: title })}
          >
            <Download aria-hidden="true" />
            {t('reports.export.csv')}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('reports.gst.empty')}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              {head.map((h, i) => (
                <Th key={h} className={i === 0 ? undefined : 'text-end'}>
                  {h}
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {rows.map((row, r) => (
              <Tr key={`${row[0]}-${r}`}>
                {row.map((cell, i) => (
                  <Td
                    key={i}
                    className={i === 0 ? 'break-words' : 'text-end whitespace-nowrap tabular-nums'}
                  >
                    {cell}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
