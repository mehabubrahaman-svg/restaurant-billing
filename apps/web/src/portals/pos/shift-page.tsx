import type { PaymentMethod, ShiftReport } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  ArrowLeft,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Plus,
  Printer,
  RefreshCw,
  Select,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  Trash,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { QueryState } from '../../features/admin/query-state';
import { BILLING_KEYS, useCurrentShift, useShift } from '../../features/billing/billing-queries';
import {
  countedTotal,
  denominationRecord,
  EMPTY_COUNT,
  NOTES,
  type CashCount,
  type Note,
} from '../../features/billing/denominations';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { rupeesToPaise, toLatinDigits } from '../../lib/units';
import { OpenShiftForm } from './open-shift-dialog';
import { ShiftReportView, Variance } from './shift-report';

/** Tenders settled on a terminal: the cashier keys in each one's batch total at close. */
const TERMINAL_METHODS = ['CARD', 'UPI', 'WALLET'] as const;
type TerminalMethod = (typeof TERMINAL_METHODS)[number];

interface TerminalRow {
  readonly key: string;
  readonly method: TerminalMethod;
  readonly terminalLabel: string;
  readonly reported: string;
  /** Came from the shift's own payments (not added by hand). */
  readonly fromShift: boolean;
}

/** /pos/shift: open a shift, watch the X report, close it with a count. */
export function ShiftPage() {
  const { t } = useTranslation();
  const shift = useCurrentShift();
  const [closing, setClosing] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <title>{`${t('pos.tabs.shift')} · ${t('app.name')}`}</title>
      <QueryState query={shift}>
        {(report) =>
          report === null ? (
            <Card className="max-w-md">
              <CardHeader>
                <CardTitle>{t('pos.shift.noneTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <OpenShiftForm onOpened={() => undefined} />
              </CardContent>
            </Card>
          ) : closing ? (
            <CloseShift
              report={report}
              onBack={() => setClosing(false)}
              onClosed={(z) => void navigate(`/pos/shift/${z.id}`)}
              refresh={() => shift.refetch()}
            />
          ) : (
            <>
              <ShiftReportView report={report} />
              <div className="flex flex-wrap justify-end gap-2">
                <PrintShiftButton shiftId={report.id} />
                <Button variant="outline" onClick={() => void shift.refetch()}>
                  <RefreshCw aria-hidden="true" />
                  {t('pos.shift.refresh')}
                </Button>
                <Button onClick={() => setClosing(true)}>{t('pos.shift.close')}</Button>
              </div>
            </>
          )
        }
      </QueryState>
    </div>
  );
}

function initialTerminals(report: ShiftReport): TerminalRow[] {
  return report.tenders
    .filter((x): x is typeof x & { method: TerminalMethod } =>
      (TERMINAL_METHODS as readonly string[]).includes(x.method),
    )
    .map((x) => ({
      key: `${x.method}|${x.terminalLabel}`,
      method: x.method,
      terminalLabel: x.terminalLabel,
      reported: '',
      fromShift: true,
    }));
}

const countOf = (s: string) => {
  const clean = toLatinDigits(s.trim());
  return /^\d{1,5}$/.test(clean) ? Number(clean) : clean === '' ? 0 : null;
};

/** Close: count the drawer by notes, key in each terminal's batch total, confirm the variances. */
function CloseShift({
  report,
  onBack,
  onClosed,
  refresh,
}: {
  report: ShiftReport;
  onBack: () => void;
  onClosed: (z: ShiftReport) => void;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const [step, setStep] = useState<'count' | 'confirm'>('count');
  const [notes, setNotes] = useState<Record<Note, string>>({
    500: '',
    200: '',
    100: '',
    50: '',
    20: '',
    10: '',
  });
  const [coins, setCoins] = useState('');
  const [terminals, setTerminals] = useState<TerminalRow[]>(() => initialTerminals(report));
  const [remarks, setRemarks] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const key = useRef(newIdempotencyKey());

  const counts = NOTES.map((n) => countOf(notes[n]));
  const coinRupees = coins.trim() === '' ? 0 : countOf(coins);
  const count: CashCount | null =
    counts.every((c) => c !== null) && coinRupees !== null
      ? {
          notes: Object.fromEntries(NOTES.map((n, i) => [n, counts[i]!])) as Record<Note, number>,
          coins: coinRupees * 100,
        }
      : null;
  const counted = countedTotal(count ?? EMPTY_COUNT);
  const reported = terminals.map((r) => rupeesToPaise(r.reported === '' ? '' : r.reported));
  const valid =
    count !== null &&
    reported.every((r) => r !== null) &&
    terminals.every((r) => r.terminalLabel.trim() !== '' || r.fromShift);

  const close = useMutation({
    mutationFn: () =>
      api.cashShifts.close(
        report.id,
        {
          version: report.version,
          countedCash: counted,
          denominations: denominationRecord(count ?? EMPTY_COUNT),
          tenders: terminals.map((r, i) => ({
            method: r.method as PaymentMethod,
            terminalLabel: r.terminalLabel.trim(),
            reportedAmount: reported[i] ?? 0,
          })),
          ...(remarks.trim() === '' ? {} : { notes: remarks.trim() }),
        },
        { idempotencyKey: key.current },
      ),
    onSuccess: (z) => {
      queryClient.setQueryData(BILLING_KEYS.currentShift, null);
      queryClient.setQueryData(BILLING_KEYS.shift(z.id), z);
      onClosed(z);
    },
  });

  if (step === 'confirm' && count !== null) {
    const expectedOf = (r: TerminalRow) =>
      report.tenders.find(
        (x) => x.method === r.method && x.terminalLabel === r.terminalLabel.trim(),
      )?.expected ?? 0;
    const rows = [
      { key: 'cash', label: t('pos.tenders.CASH'), expected: report.expectedCash, actual: counted },
      ...terminals.map((r, i) => ({
        key: r.key,
        label: `${t(`pos.tenders.${r.method}`)}${r.terminalLabel.trim() === '' ? '' : ` · ${r.terminalLabel.trim()}`}`,
        expected: expectedOf(r),
        actual: reported[i] ?? 0,
      })),
    ];
    const mismatches = rows.filter((r) => r.actual !== r.expected).length;
    return (
      <section className="flex flex-col gap-4" aria-labelledby="confirm-title">
        <h2 id="confirm-title" className="text-xl font-bold">
          {t('pos.shift.confirmTitle')}
        </h2>
        <Alert tone={mismatches === 0 ? 'success' : 'warning'}>
          {t('pos.shift.confirmSummary', { count: mismatches })}
        </Alert>
        <Table>
          <caption className="sr-only">{t('pos.shift.confirmTitle')}</caption>
          <THead>
            <Tr>
              <Th>{t('pos.shift.tender')}</Th>
              <Th className="text-end">{t('pos.shift.expected')}</Th>
              <Th className="text-end">{t('pos.shift.reported')}</Th>
              <Th>{t('pos.shift.variance')}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.key}>
                <Td>{r.label}</Td>
                <Td className="text-end tabular-nums">{money(r.expected)}</Td>
                <Td className="text-end tabular-nums">{money(r.actual)}</Td>
                <Td>
                  <Variance value={r.actual - r.expected} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {close.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(close.error)}
          </Alert>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setStep('count')} disabled={close.isPending}>
            {t('common.back')}
          </Button>
          <Button onClick={() => close.mutate()} disabled={close.isPending}>
            {close.isPending ? t('common.saving') : t('pos.shift.closeConfirm')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setShowErrors(true);
        if (!valid) return;
        // Expected figures can move while counting (a late payment): fetch the latest first.
        void refresh().then(() => setStep('confirm'));
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" aria-label={t('common.back')} onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <h2 className="text-xl font-bold">{t('pos.shift.closeTitle')}</h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('pos.shift.countCash')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {NOTES.map((note, i) => (
                <li
                  key={note}
                  className="grid grid-cols-[5rem_minmax(0,1fr)_7rem] items-center gap-2"
                >
                  <label htmlFor={`note-${note}`} className="font-medium tabular-nums">
                    {t('pos.shift.note', { rupees: note })}
                  </label>
                  <Input
                    id={`note-${note}`}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label={t('pos.shift.noteCount', {
                      note: t('pos.shift.note', { rupees: note }),
                    })}
                    aria-invalid={counts[i] === null ? true : undefined}
                    value={notes[note]}
                    placeholder="0"
                    onChange={(e) => setNotes((s) => ({ ...s, [note]: e.target.value }))}
                  />
                  <span className="text-end text-muted-foreground tabular-nums">
                    {money(note * 100 * (counts[i] ?? 0))}
                  </span>
                </li>
              ))}
              <li className="grid grid-cols-[5rem_minmax(0,1fr)_7rem] items-center gap-2">
                <label htmlFor="coins" className="font-medium">
                  {t('pos.shift.coins')}
                </label>
                <Input
                  id="coins"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={t('pos.shift.coinsLabel')}
                  aria-invalid={coinRupees === null ? true : undefined}
                  value={coins}
                  placeholder="0"
                  onChange={(e) => setCoins(e.target.value)}
                />
                <span className="text-end text-muted-foreground tabular-nums">
                  {money((coinRupees ?? 0) * 100)}
                </span>
              </li>
            </ul>
            {showErrors && count === null && (
              <p role="alert" className="text-sm font-medium text-state-danger-fg">
                {t('pos.shift.countInvalid')}
              </p>
            )}
            <p className="flex justify-between border-t pt-2 text-lg font-bold">
              <span>{t('pos.shift.countedCash')}</span>
              <span className="tabular-nums" data-testid="counted-total">
                {money(counted)}
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('pos.shift.terminals')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t('pos.shift.terminalsHint')}</p>
            {terminals.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('pos.shift.noTerminals')}</p>
            )}
            <ul className="flex flex-col gap-3">
              {terminals.map((r, i) => {
                const name = `${t(`pos.tenders.${r.method}`)}${r.terminalLabel === '' ? '' : ` · ${r.terminalLabel}`}`;
                const update = (patch: Partial<TerminalRow>) =>
                  setTerminals((list) =>
                    list.map((x) => (x.key === r.key ? { ...x, ...patch } : x)),
                  );
                return (
                  <li key={r.key} className="flex flex-col gap-2 rounded-lg border p-2">
                    {r.fromShift ? (
                      <p className="font-medium">{name}</p>
                    ) : (
                      <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-end gap-2">
                        <Field label={t('pos.shift.method')}>
                          {(p) => (
                            <Select
                              {...p}
                              value={r.method}
                              onChange={(e) => update({ method: e.target.value as TerminalMethod })}
                            >
                              {TERMINAL_METHODS.map((m) => (
                                <option key={m} value={m}>
                                  {t(`pos.tenders.${m}`)}
                                </option>
                              ))}
                            </Select>
                          )}
                        </Field>
                        <Field
                          label={t('pos.pay.terminal')}
                          error={
                            showErrors && r.terminalLabel.trim() === ''
                              ? t('validation.required')
                              : undefined
                          }
                        >
                          {(p) => (
                            <Input
                              {...p}
                              maxLength={40}
                              value={r.terminalLabel}
                              onChange={(e) => update({ terminalLabel: e.target.value })}
                            />
                          )}
                        </Field>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('pos.shift.removeTerminal')}
                          onClick={() =>
                            setTerminals((list) => list.filter((x) => x.key !== r.key))
                          }
                        >
                          <Trash aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                    <Field
                      label={t('pos.shift.batchTotal', { name })}
                      error={
                        showErrors && reported[i] === null ? t('validation.amount') : undefined
                      }
                    >
                      {(p) => (
                        <Input
                          {...p}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0.00"
                          value={r.reported}
                          onChange={(e) => update({ reported: e.target.value })}
                        />
                      )}
                    </Field>
                  </li>
                );
              })}
            </ul>
            <Button
              variant="outline"
              onClick={() =>
                setTerminals((list) => [
                  ...list,
                  {
                    key: `new-${list.length}-${Date.now()}`,
                    method: 'CARD',
                    terminalLabel: '',
                    reported: '',
                    fromShift: false,
                  },
                ])
              }
            >
              <Plus aria-hidden="true" />
              {t('pos.shift.addTerminal')}
            </Button>
          </CardContent>
        </Card>
      </div>
      <Field label={t('pos.shift.notes')}>
        {(p) => (
          <Textarea
            {...p}
            rows={2}
            maxLength={500}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="lg">
          {t('pos.shift.review')}
        </Button>
      </div>
    </form>
  );
}

/** /pos/shift/:shiftId: a shift's report; the Z report once closed, printable from the browser. */
export function ShiftReportPage() {
  const { t } = useTranslation();
  const { shiftId = '' } = useParams();
  const shift = useShift(shiftId);
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <title>{`${t('pos.shift.zTitle')} · ${t('app.name')}`}</title>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost">
          <Link to="/pos/shift">
            <ArrowLeft aria-hidden="true" />
            {t('pos.shift.backToShift')}
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <PrintShiftButton shiftId={shiftId} />
          <Button variant="outline" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            {t('pos.print.browser')}
          </Button>
        </div>
      </div>
      <QueryState query={shift}>{(report) => <ShiftReportView report={report} />}</QueryState>
    </div>
  );
}

/** Prints the X or Z report on the report printer; the browser's print is the fallback. */
function PrintShiftButton({ shiftId }: { shiftId: string }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const print = useMutation({
    mutationFn: () => api.cashShifts.print(shiftId),
    onSuccess: (outcome) => toast(t('pos.print.sent', { printer: outcome.printerName })),
    onError: (error) => toast(`${errorMessage(error)} ${t('pos.print.fallback')}`, 'danger'),
  });
  return (
    <Button variant="outline" disabled={print.isPending} onClick={() => print.mutate()}>
      <Printer aria-hidden="true" />
      {print.isPending ? t('pos.print.printing') : t('pos.print.onPrinter')}
    </Button>
  );
}
