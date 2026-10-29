import type {
  BalanceSheet,
  CashFlow,
  GstSummary,
  ProfitAndLoss,
  TrialBalance,
} from '@restroos/contracts';
import { Alert, Button, Card, cn, Printer, Table, TBody, Td, Th, THead, Tr } from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  useBalanceSheet,
  useCashFlow,
  useGstSummary,
  useProfitAndLoss,
  useTrialBalance,
} from '../../features/accounting/accounting-queries';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { useDayFormat } from '../../features/reports/use-day-format';
import { useFormat } from '../../i18n/use-format';
import { tDynamic } from '../../lib/dynamic-t';
import { useMoney, useTaxRate } from '../purchase/purchase-ui';
import { BOOKS_PERMISSIONS } from './accounts-ui';
import { AsOfField, DateRangeFields, useReportParams } from './date-range';

/** A statement's title, what it covers, its date picker and a print button. */
function StatementHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-col gap-3">
      <title>{`${title} · ${t('app.name')}`}</title>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle !== null && <p className="text-muted-foreground">{subtitle}</p>}
        </div>
        <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          {t('purchase.print')}
        </Button>
      </div>
      <div className="flex flex-wrap items-start gap-3 print:hidden">{children}</div>
    </header>
  );
}

/** "Balanced" in green, or by how much debits and credits (or the two sides) differ. */
function BalanceState({ balanced, ok, off }: { balanced: boolean; ok: string; off: string }) {
  return (
    <Alert tone={balanced ? 'success' : 'danger'} role="status" data-balanced={balanced}>
      <span className="font-semibold">{balanced ? ok : off}</span>
    </Alert>
  );
}

function RangedHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  const day = useDayFormat();
  const { from, to, valid, update } = useReportParams();
  return (
    <StatementHeader
      title={title}
      subtitle={valid ? t('accounts.statements.period', { from: day(from), to: day(to) }) : null}
    >
      <DateRangeFields from={from} to={to} onChange={(r) => update(r)} />
    </StatementHeader>
  );
}

function AsOfHeader({ title, asOf }: { title: string; asOf: string }) {
  const { t } = useTranslation();
  const day = useDayFormat();
  const { update } = useReportParams();
  return (
    <StatementHeader title={title} subtitle={t('accounts.statements.asOf', { date: day(asOf) })}>
      <AsOfField value={asOf} onChange={(v) => update({ asOf: v })} />
    </StatementHeader>
  );
}

// ---- trial balance ---------------------------------------------------------------------

/** /accounts/statements?asOf=: every account's debit or credit balance; they must agree. */
export function TrialBalancePage() {
  const { t } = useTranslation();
  const { asOf } = useReportParams();
  const tb = useTrialBalance(asOf);
  return (
    <div className="flex flex-col gap-4">
      <AsOfHeader title={t('accounts.statements.trialBalance.title')} asOf={asOf} />
      <QueryState query={tb}>{(data) => <TrialBalanceBody tb={data} />}</QueryState>
    </div>
  );
}

function TrialBalanceBody({ tb }: { tb: TrialBalance }) {
  const { t } = useTranslation();
  const money = useMoney();
  const canReadBooks = usePermission(BOOKS_PERMISSIONS);
  return (
    <div className="flex flex-col gap-3">
      <BalanceState
        balanced={tb.balanced}
        ok={t('accounts.statements.trialBalance.balanced', { amount: money(tb.totalDebit) })}
        off={t('accounts.statements.trialBalance.unbalanced', {
          debit: money(tb.totalDebit),
          credit: money(tb.totalCredit),
          difference: money(Math.abs(tb.totalDebit - tb.totalCredit)),
        })}
      />
      {tb.rows.length === 0 ? (
        <p className="text-muted-foreground">{t('accounts.statements.nothingYet')}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th className="w-20">{t('accounts.chart.code')}</Th>
              <Th>{t('accounts.chart.name')}</Th>
              <Th>{t('accounts.chart.type')}</Th>
              <Th className="text-end">{t('accounts.debit')}</Th>
              <Th className="text-end">{t('accounts.credit')}</Th>
            </Tr>
          </THead>
          <TBody>
            {tb.rows.map((r) => (
              <Tr key={r.accountId}>
                <Td className="font-mono tabular-nums">{r.code}</Td>
                <Td className="break-words">
                  {canReadBooks ? (
                    <Link
                      to={`/accounts/ledgers?account=${encodeURIComponent(r.accountId)}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                </Td>
                <Td className="whitespace-nowrap">{t(`accounts.types.${r.type}`)}</Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {r.debit === 0 ? '' : money(r.debit)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {r.credit === 0 ? '' : money(r.credit)}
                </Td>
              </Tr>
            ))}
          </TBody>
          <tfoot className="border-t-2 bg-muted font-semibold">
            <Tr>
              <Th scope="row" colSpan={3}>
                {t('accounts.total')}
              </Th>
              <Td className="text-end whitespace-nowrap tabular-nums">{money(tb.totalDebit)}</Td>
              <Td className="text-end whitespace-nowrap tabular-nums">{money(tb.totalCredit)}</Td>
            </Tr>
          </tfoot>
        </Table>
      )}
    </div>
  );
}

// ---- grouped statements (P&L, balance sheet) ----------------------------------------------

interface Group {
  readonly title: string;
  readonly rows: readonly { accountId: string; code: string; name: string; amount: number }[];
  /** Extra lines after the accounts (profit to date on the balance sheet). */
  readonly extra?: readonly (readonly [string, number])[];
  readonly totalLabel: string;
  readonly total: number;
}

/** Account groups with their totals, then the statement's result lines. */
function GroupedStatement({
  groups,
  results,
}: {
  groups: readonly Group[];
  results: readonly { label: string; amount: number; note?: string; tone?: 'good' | 'bad' }[];
}) {
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{t('accounts.chart.name')}</Th>
          <Th className="text-end">{t('accounts.statements.amount')}</Th>
        </Tr>
      </THead>
      {groups.map((g) => (
        <TBody key={g.title}>
          <Tr className="bg-muted/50">
            <Th scope="rowgroup" colSpan={2} className="text-sm text-foreground">
              {g.title}
            </Th>
          </Tr>
          {g.rows.length === 0 && (
            <Tr>
              <Td colSpan={2} className="text-muted-foreground">
                {t('accounts.statements.noAccounts')}
              </Td>
            </Tr>
          )}
          {g.rows.map((r) => (
            <Tr key={r.accountId}>
              <Td className="ps-6 break-words">
                <span className="me-2 font-mono text-xs text-muted-foreground">{r.code}</span>
                {r.name}
              </Td>
              <Td className="text-end whitespace-nowrap tabular-nums">{money(r.amount)}</Td>
            </Tr>
          ))}
          {(g.extra ?? []).map(([label, amount]) => (
            <Tr key={label}>
              <Td className="ps-6 break-words">{label}</Td>
              <Td className="text-end whitespace-nowrap tabular-nums">{money(amount)}</Td>
            </Tr>
          ))}
          <Tr>
            <Th scope="row" className="text-sm text-foreground">
              {g.totalLabel}
            </Th>
            <Td className="text-end font-semibold whitespace-nowrap tabular-nums">
              {money(g.total)}
            </Td>
          </Tr>
        </TBody>
      ))}
      <tfoot className="border-t-2">
        {results.map((r) => (
          <Tr key={r.label} className="bg-muted">
            <Th scope="row" className="text-base text-foreground">
              {r.label}
              {r.note !== undefined && (
                <span className="block text-xs font-normal text-muted-foreground">{r.note}</span>
              )}
            </Th>
            <Td
              className={cn(
                'text-end text-base font-bold whitespace-nowrap tabular-nums',
                r.tone === 'good' && 'text-state-available-fg',
                r.tone === 'bad' && 'text-state-danger-fg',
              )}
            >
              {money(r.amount)}
            </Td>
          </Tr>
        ))}
      </tfoot>
    </Table>
  );
}

// ---- profit and loss ------------------------------------------------------------------------

/** /accounts/statements/profit-and-loss?from=&to=: income, cost of sales, gross margin, net profit. */
export function ProfitLossPage() {
  const { t } = useTranslation();
  const { from, to, valid } = useReportParams();
  const pnl = useProfitAndLoss(from, to, valid);
  return (
    <div className="flex flex-col gap-4">
      <RangedHeader title={t('accounts.statements.profitAndLoss.title')} />
      {valid && <QueryState query={pnl}>{(data) => <ProfitLossBody pnl={data} />}</QueryState>}
    </div>
  );
}

function ProfitLossBody({ pnl: p }: { pnl: ProfitAndLoss }) {
  const { t } = useTranslation();
  const format = useFormat();
  const money = useMoney();
  const margin =
    p.grossMarginBp === null
      ? t('accounts.statements.profitAndLoss.noMargin')
      : t('accounts.statements.profitAndLoss.margin', {
          margin: format.number(p.grossMarginBp / 10_000, {
            style: 'percent',
            maximumFractionDigits: 2,
          }),
        });
  const profit = p.netProfit >= 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [t('accounts.statements.profitAndLoss.income'), money(p.totalIncome), null],
          [t('accounts.statements.profitAndLoss.grossProfit'), money(p.grossProfit), margin],
          [
            profit
              ? t('accounts.statements.profitAndLoss.netProfit')
              : t('accounts.statements.profitAndLoss.netLoss'),
            money(Math.abs(p.netProfit)),
            null,
          ],
        ].map(([label, value, note], i) => (
          <Card key={i} className="flex flex-col gap-1 p-4">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span
              className={cn(
                'text-xl font-bold break-words tabular-nums',
                i === 2 && (profit ? 'text-state-available-fg' : 'text-state-danger-fg'),
              )}
            >
              {value}
            </span>
            {note !== null && <span className="text-sm text-muted-foreground">{note}</span>}
          </Card>
        ))}
      </div>
      <GroupedStatement
        groups={[
          {
            title: t('accounts.statements.profitAndLoss.income'),
            rows: p.income,
            totalLabel: t('accounts.statements.profitAndLoss.totalIncome'),
            total: p.totalIncome,
          },
          {
            title: t('accounts.statements.profitAndLoss.costOfSales'),
            rows: p.costOfSales,
            totalLabel: t('accounts.statements.profitAndLoss.totalCostOfSales'),
            total: p.totalCostOfSales,
          },
          {
            title: t('accounts.statements.profitAndLoss.expenses'),
            rows: p.expenses,
            totalLabel: t('accounts.statements.profitAndLoss.totalExpenses'),
            total: p.totalExpenses,
          },
        ]}
        results={[
          {
            label: t('accounts.statements.profitAndLoss.grossProfit'),
            amount: p.grossProfit,
            note: margin,
          },
          {
            label: profit
              ? t('accounts.statements.profitAndLoss.netProfit')
              : t('accounts.statements.profitAndLoss.netLoss'),
            amount: p.netProfit,
            tone: profit ? 'good' : 'bad',
          },
        ]}
      />
    </div>
  );
}

// ---- balance sheet --------------------------------------------------------------------------

/** /accounts/statements/balance-sheet?asOf=: what the business owns, owes and is worth. */
export function BalanceSheetPage() {
  const { t } = useTranslation();
  const { asOf } = useReportParams();
  const bs = useBalanceSheet(asOf);
  return (
    <div className="flex flex-col gap-4">
      <AsOfHeader title={t('accounts.statements.balanceSheet.title')} asOf={asOf} />
      <QueryState query={bs}>{(data) => <BalanceSheetBody bs={data} />}</QueryState>
    </div>
  );
}

function BalanceSheetBody({ bs }: { bs: BalanceSheet }) {
  const { t } = useTranslation();
  const money = useMoney();
  const both = bs.totalLiabilities + bs.totalEquity;
  return (
    <div className="flex flex-col gap-3">
      <BalanceState
        balanced={bs.balanced}
        ok={t('accounts.statements.balanceSheet.balanced', { amount: money(bs.totalAssets) })}
        off={t('accounts.statements.balanceSheet.unbalanced', {
          assets: money(bs.totalAssets),
          both: money(both),
          difference: money(Math.abs(bs.totalAssets - both)),
        })}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <GroupedStatement
          groups={[
            {
              title: t('accounts.types.ASSET'),
              rows: bs.assets,
              totalLabel: t('accounts.statements.balanceSheet.totalAssets'),
              total: bs.totalAssets,
            },
          ]}
          results={[
            { label: t('accounts.statements.balanceSheet.assetsSide'), amount: bs.totalAssets },
          ]}
        />
        <GroupedStatement
          groups={[
            {
              title: t('accounts.types.LIABILITY'),
              rows: bs.liabilities,
              totalLabel: t('accounts.statements.balanceSheet.totalLiabilities'),
              total: bs.totalLiabilities,
            },
            {
              title: t('accounts.types.EQUITY'),
              rows: bs.equity,
              extra: [[t('accounts.statements.balanceSheet.profitToDate'), bs.profitToDate]],
              totalLabel: t('accounts.statements.balanceSheet.totalEquity'),
              total: bs.totalEquity,
            },
          ]}
          results={[{ label: t('accounts.statements.balanceSheet.otherSide'), amount: both }]}
        />
      </div>
    </div>
  );
}

// ---- cash flow --------------------------------------------------------------------------------

/** /accounts/statements/cash-flow?from=&to=: cash and bank in and out, by where it came from. */
export function CashFlowPage() {
  const { t } = useTranslation();
  const { from, to, valid } = useReportParams();
  const flow = useCashFlow(from, to, valid);
  return (
    <div className="flex flex-col gap-4">
      <RangedHeader title={t('accounts.statements.cashFlow.title')} />
      {valid && <QueryState query={flow}>{(data) => <CashFlowBody flow={data} />}</QueryState>}
    </div>
  );
}

function CashFlowBody({ flow: f }: { flow: CashFlow }) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  const category = (code: string) => tDynamic(t, `accounts.cashCategories.${code}`, code);
  const totalIn = f.inflows.reduce((s, x) => s + x.amount, 0);
  const totalOut = f.outflows.reduce((s, x) => s + x.amount, 0);
  const flows = (title: string, rows: CashFlow['inflows'], totalLabel: string, total: number) => (
    <TBody>
      <Tr className="bg-muted/50">
        <Th scope="rowgroup" colSpan={2} className="text-sm text-foreground">
          {title}
        </Th>
      </Tr>
      {rows.length === 0 && (
        <Tr>
          <Td colSpan={2} className="text-muted-foreground">
            {t('accounts.statements.cashFlow.none')}
          </Td>
        </Tr>
      )}
      {rows.map((r) => (
        <Tr key={r.category}>
          <Td className="ps-6">{category(r.category)}</Td>
          <Td className="text-end whitespace-nowrap tabular-nums">{money(r.amount)}</Td>
        </Tr>
      ))}
      <Tr>
        <Th scope="row" className="text-sm text-foreground">
          {totalLabel}
        </Th>
        <Td className="text-end font-semibold whitespace-nowrap tabular-nums">{money(total)}</Td>
      </Tr>
    </TBody>
  );
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Table>
        <THead>
          <Tr>
            <Th>{t('accounts.statements.cashFlow.flow')}</Th>
            <Th className="text-end">{t('accounts.statements.amount')}</Th>
          </Tr>
        </THead>
        <TBody>
          <Tr>
            <Th scope="row" className="text-sm text-foreground">
              {t('accounts.statements.cashFlow.opening')}
            </Th>
            <Td className="text-end font-semibold whitespace-nowrap tabular-nums">
              {money(f.openingCash)}
            </Td>
          </Tr>
        </TBody>
        {flows(
          t('accounts.statements.cashFlow.in'),
          f.inflows,
          t('accounts.statements.cashFlow.totalIn'),
          totalIn,
        )}
        {flows(
          t('accounts.statements.cashFlow.out'),
          f.outflows,
          t('accounts.statements.cashFlow.totalOut'),
          totalOut,
        )}
        <tfoot className="border-t-2">
          <Tr className="bg-muted">
            <Th scope="row" className="text-base text-foreground">
              {t('accounts.statements.cashFlow.netChange')}
            </Th>
            <Td
              className={cn(
                'text-end text-base font-bold whitespace-nowrap tabular-nums',
                f.netChange < 0 && 'text-state-danger-fg',
              )}
            >
              {money(f.netChange)}
            </Td>
          </Tr>
          <Tr className="bg-muted">
            <Th scope="row" className="text-base text-foreground">
              {t('accounts.statements.cashFlow.closing')}
            </Th>
            <Td className="text-end text-base font-bold whitespace-nowrap tabular-nums">
              {money(f.closingCash)}
            </Td>
          </Tr>
        </tfoot>
      </Table>
      <section aria-labelledby="cash-accounts" className="flex flex-col gap-2">
        <h2 id="cash-accounts" className="font-semibold">
          {t('accounts.statements.cashFlow.accounts', { date: day(f.to) })}
        </h2>
        <ul className="flex flex-col divide-y rounded-xl border bg-surface">
          {f.accounts.map((a) => (
            <li key={a.accountId} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="min-w-0 break-words">{a.name}</span>
              <span className="font-medium whitespace-nowrap tabular-nums">{money(a.amount)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---- GST summary --------------------------------------------------------------------------------

/** /accounts/statements/gst?from=&to=: outward supplies by rate, output and input tax, net payable. */
export function GstSummaryPage() {
  const { t } = useTranslation();
  const { from, to, valid } = useReportParams();
  const gst = useGstSummary(from, to, valid);
  return (
    <div className="flex flex-col gap-4">
      <RangedHeader title={t('accounts.statements.gst.title')} />
      {valid && <QueryState query={gst}>{(data) => <GstBody gst={data} />}</QueryState>}
    </div>
  );
}

const HEADS = ['cgst', 'sgst', 'igst', 'cess'] as const;

function GstBody({ gst: g }: { gst: GstSummary }) {
  const { t } = useTranslation();
  const money = useMoney();
  const format = useFormat();
  const rate = useTaxRate();
  const cell = (paise: number) => (
    <Td className="text-end whitespace-nowrap tabular-nums">{money(paise)}</Td>
  );
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="gst-outward" className="flex flex-col gap-2">
        <h2 id="gst-outward" className="text-lg font-semibold">
          {t('accounts.statements.gst.outward')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('accounts.statements.gst.outwardHint')}</p>
        {g.outward.length === 0 ? (
          <p className="text-muted-foreground">{t('accounts.statements.gst.noOutward')}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t('accounts.statements.gst.supply')}</Th>
                <Th className="text-end">{t('accounts.statements.gst.rate')}</Th>
                <Th className="text-end">{t('accounts.statements.gst.taxable')}</Th>
                {HEADS.map((h) => (
                  <Th key={h} className="text-end">
                    {t(`accounts.statements.gst.heads.${h}`)}
                  </Th>
                ))}
                <Th className="text-end">{t('accounts.statements.gst.invoices')}</Th>
              </Tr>
            </THead>
            <TBody>
              {g.outward.map((o) => (
                <Tr key={`${o.supplyType}-${o.rateBp}`}>
                  <Td>{t(`accounts.statements.gst.supplyTypes.${o.supplyType}`)}</Td>
                  <Td className="text-end tabular-nums">{rate(o.rateBp)}</Td>
                  {cell(o.taxableValue)}
                  {HEADS.map((h) => (
                    <Td key={h} className="text-end whitespace-nowrap tabular-nums">
                      {money(o[h])}
                    </Td>
                  ))}
                  <Td className="text-end tabular-nums">{format.number(o.invoiceCount)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {g.operatorPaid.invoiceCount > 0 && (
          <p className="text-sm">
            {t('accounts.statements.gst.operatorPaid', {
              amount: money(g.operatorPaid.taxableValue),
              count: g.operatorPaid.invoiceCount,
            })}
          </p>
        )}
      </section>

      <section aria-labelledby="gst-3b" className="flex flex-col gap-2">
        <h2 id="gst-3b" className="text-lg font-semibold">
          {t('accounts.statements.gst.summary')}
        </h2>
        <Table>
          <THead>
            <Tr>
              <Th>
                <span className="sr-only">{t('accounts.statements.gst.line')}</span>
              </Th>
              {HEADS.map((h) => (
                <Th key={h} className="text-end">
                  {t(`accounts.statements.gst.heads.${h}`)}
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            <Tr>
              <Th scope="row" className="text-sm text-foreground">
                {t('accounts.statements.gst.outputTax')}
              </Th>
              {HEADS.map((h) => (
                <Td key={h} className="text-end whitespace-nowrap tabular-nums">
                  {money(g.outputTax[h])}
                </Td>
              ))}
            </Tr>
            <Tr>
              <Th scope="row" className="text-sm text-foreground">
                {t('accounts.statements.gst.inputTax')}
              </Th>
              {HEADS.map((h) => (
                <Td key={h} className="text-end whitespace-nowrap tabular-nums">
                  {money(g.inputTax[h])}
                </Td>
              ))}
            </Tr>
          </TBody>
          <tfoot className="border-t-2 bg-muted font-semibold">
            <Tr>
              <Th scope="row" className="text-sm text-foreground">
                {t('accounts.statements.gst.netPayable')}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t('accounts.statements.gst.netHint')}
                </span>
              </Th>
              {HEADS.map((h) => (
                <Td
                  key={h}
                  className={cn(
                    'text-end whitespace-nowrap tabular-nums',
                    g.netPayable[h] < 0 && 'text-state-available-fg',
                  )}
                >
                  {money(g.netPayable[h])}
                </Td>
              ))}
            </Tr>
          </tfoot>
        </Table>
      </section>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-semibold">{t('accounts.statements.gst.vat')}</h2>
        <p className="text-sm text-muted-foreground">{t('accounts.statements.gst.vatHint')}</p>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm sm:max-w-md">
          <dt className="text-muted-foreground">{t('accounts.statements.gst.taxable')}</dt>
          <dd className="text-end tabular-nums">{money(g.vat.taxableValue)}</dd>
          <dt className="text-muted-foreground">{t('accounts.statements.gst.vatAmount')}</dt>
          <dd className="text-end tabular-nums">{money(g.vat.vat)}</dd>
          <dt className="text-muted-foreground">{t('accounts.statements.gst.surcharge')}</dt>
          <dd className="text-end tabular-nums">{money(g.vat.surcharge)}</dd>
        </dl>
      </Card>
    </div>
  );
}
