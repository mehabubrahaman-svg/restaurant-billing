import type { Ledger, PartyLedger } from '@restroos/contracts';
import {
  Button,
  Field,
  Input,
  SegmentedControl,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import type { LedgerPartyType } from '../../api/endpoints';
import {
  useAccounts,
  useLedger,
  usePartyLedger,
} from '../../features/accounting/accounting-queries';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { formatPhone, useCustomerSearch } from '../../features/customers/customer-queries';
import { useVendors } from '../../features/purchasing/purchasing-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { useMoney } from '../purchase/purchase-ui';
import { AccountOptions, SourceBadge } from './accounts-ui';
import { DateRangeFields, useReportParams } from './date-range';

type Mode = 'account' | 'party';
const PARTY_TYPES: readonly LedgerPartyType[] = ['VENDOR', 'CUSTOMER'];

/**
 * /accounts/ledgers?account=&from=&to= (an account's ledger) and
 * ?party=VENDOR|CUSTOMER&id= (a vendor's or customer's own ledger).
 */
export function LedgersPage() {
  const { t } = useTranslation();
  const { params, from, to, valid, update } = useReportParams();
  const partyParam = params.get('party');
  const mode: Mode = partyParam === null ? 'account' : 'party';
  const partyType: LedgerPartyType = partyParam === 'CUSTOMER' ? 'CUSTOMER' : 'VENDOR';

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('accounts.ledgers.title')}
        description={t('accounts.ledgers.description')}
      />
      <SegmentedControl<Mode>
        aria-label={t('accounts.ledgers.kind')}
        className="self-start"
        value={mode}
        onValueChange={(m) =>
          update(
            m === 'party'
              ? { party: 'VENDOR', account: null, id: null }
              : { party: null, id: null },
          )
        }
        options={[
          { value: 'account', label: t('accounts.ledgers.account') },
          { value: 'party', label: t('accounts.ledgers.party') },
        ]}
      />
      {mode === 'account' ? (
        <AccountLedger
          accountId={params.get('account') ?? ''}
          from={from}
          to={to}
          valid={valid}
          onAccount={(id) => update({ account: id === '' ? null : id })}
          onRange={(r) => update(r)}
        />
      ) : (
        <PartyLedgerView
          type={partyType}
          id={params.get('id') ?? ''}
          q={params.get('q') ?? ''}
          from={from}
          to={to}
          valid={valid}
          onType={(type) => update({ party: type, id: null, q: null })}
          onParty={(id) => update({ id: id === '' ? null : id })}
          onQuery={(q) => update({ q: q === '' ? null : q })}
          onRange={(r) => update(r)}
        />
      )}
    </div>
  );
}

function AccountLedger({
  accountId,
  from,
  to,
  valid,
  onAccount,
  onRange,
}: {
  accountId: string;
  from: string;
  to: string;
  valid: boolean;
  onAccount: (id: string) => void;
  onRange: (range: { from: string; to: string }) => void;
}) {
  const { t } = useTranslation();
  const accounts = useAccounts();
  const ledger = useLedger(accountId, from, to, valid && accountId !== '');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <Field label={t('accounts.journal.account')} className="w-full sm:w-80">
          {(p) => (
            <Select {...p} value={accountId} onChange={(e) => onAccount(e.target.value)}>
              <option value="" disabled>
                {t('accounts.journal.form.chooseAccount')}
              </option>
              <AccountOptions accounts={accounts.data?.data ?? []} />
            </Select>
          )}
        </Field>
        <DateRangeFields from={from} to={to} onChange={onRange} />
      </div>
      {accountId === '' ? (
        <p className="text-muted-foreground">{t('accounts.ledgers.pickAccount')}</p>
      ) : (
        valid && <QueryState query={ledger}>{(l) => <LedgerTable ledger={l} />}</QueryState>
      )}
    </div>
  );
}

function PartyLedgerView({
  type,
  id,
  q,
  from,
  to,
  valid,
  onType,
  onParty,
  onQuery,
  onRange,
}: {
  type: LedgerPartyType;
  id: string;
  /** What was typed into the customer search. */
  q: string;
  from: string;
  to: string;
  valid: boolean;
  onType: (type: LedgerPartyType) => void;
  onParty: (id: string) => void;
  onQuery: (q: string) => void;
  onRange: (range: { from: string; to: string }) => void;
}) {
  const { t } = useTranslation();
  const ledger = usePartyLedger(type, id, from, to, valid && id !== '');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('accounts.ledgers.partyType')}</span>
          <SegmentedControl<LedgerPartyType>
            aria-label={t('accounts.ledgers.partyType')}
            value={type}
            onValueChange={onType}
            options={PARTY_TYPES.map((p) => ({ value: p, label: t(`accounts.parties.${p}`) }))}
          />
        </div>
        {type === 'VENDOR' ? (
          <VendorPicker id={id} onChange={onParty} />
        ) : (
          <CustomerPicker id={id} q={q} onQuery={onQuery} onChange={onParty} />
        )}
        <DateRangeFields from={from} to={to} onChange={onRange} />
      </div>
      {id === '' ? (
        <p className="text-muted-foreground">
          {type === 'VENDOR'
            ? t('accounts.ledgers.pickVendor')
            : t('accounts.ledgers.pickCustomer')}
        </p>
      ) : (
        valid && <QueryState query={ledger}>{(l) => <PartyLedgerTable ledger={l} />}</QueryState>
      )}
    </div>
  );
}

function VendorPicker({ id, onChange }: { id: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const vendors = useVendors(true);
  return (
    <Field label={t('accounts.parties.VENDOR')} className="w-full sm:w-64">
      {(p) => (
        <Select {...p} value={id} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>
            {t('purchase.payments.chooseVendor')}
          </option>
          {(vendors.data?.data ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * Finds a guest by mobile number or name. Looking guests up needs the
 * customers permission (or billing); without it, their ledger opens from
 * their name in the day book.
 */
function CustomerPicker({
  id,
  q,
  onQuery,
  onChange,
}: {
  id: string;
  q: string;
  onQuery: (q: string) => void;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const canSearch = usePermission(['customers.view', 'customers.manage', 'billing.create']);
  const search = useCustomerSearch(canSearch ? q : '');
  const found = search.enabled ? (search.data?.data ?? []) : [];
  if (!canSearch) {
    return (
      <p className="max-w-sm self-center text-sm text-muted-foreground">
        {t('accounts.ledgers.customerFromJournal')}
      </p>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 sm:w-72">
      <Field label={t('accounts.ledgers.findCustomer')} hint={t('accounts.ledgers.findHint')}>
        {(p) => (
          <Input
            {...p}
            type="search"
            autoComplete="off"
            value={q}
            onChange={(e) => onQuery(e.target.value)}
          />
        )}
      </Field>
      {found.length > 0 && (
        <ul
          aria-label={t('accounts.ledgers.customersFound')}
          className="flex flex-col divide-y rounded-lg border bg-surface"
        >
          {found.slice(0, 8).map((c) => (
            <li key={c.id}>
              <Button
                variant="ghost"
                className="w-full justify-start rounded-none text-start"
                aria-pressed={c.id === id}
                onClick={() => onChange(c.id)}
              >
                <span className="min-w-0 break-words">
                  {c.name ?? formatPhone(c.phone)}
                  {c.name !== null && (
                    <span className="block text-xs text-muted-foreground">
                      {formatPhone(c.phone)}
                    </span>
                  )}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LedgerTable({ ledger: l }: { ledger: Ledger }) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">
        {t('accounts.accountLabel', { code: l.account.code, name: l.account.name })}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t('accounts.ledgers.normalSide', { type: t(`accounts.types.${l.account.type}`) })}
      </p>
      <Table>
        <caption className="sr-only">
          {t('accounts.ledgers.caption', { from: day(l.from), to: day(l.to) })}
        </caption>
        <LedgerHead />
        <TBody>
          <BalanceRow
            date={l.from}
            label={t('accounts.ledgers.opening')}
            amount={l.openingBalance}
          />
          {l.entries.map((e, i) => (
            <Tr key={`${e.journalEntryId}-${i}`}>
              <Td className="whitespace-nowrap">{day(e.date)}</Td>
              <Td>
                <SourceBadge type={e.sourceType} />
                <span className="block text-xs break-all text-muted-foreground">
                  {[e.entryNo, e.sourceNo].filter((s) => s !== null).join(' · ')}
                </span>
              </Td>
              <Td className="break-words">
                {e.narration}
                {e.against !== '' && (
                  <span className="block text-xs text-muted-foreground">
                    {t('accounts.ledgers.against', { accounts: e.against })}
                  </span>
                )}
              </Td>
              <Td className="text-end whitespace-nowrap tabular-nums">
                {e.debit === 0 ? '' : money(e.debit)}
              </Td>
              <Td className="text-end whitespace-nowrap tabular-nums">
                {e.credit === 0 ? '' : money(e.credit)}
              </Td>
              <Td className="text-end whitespace-nowrap tabular-nums">{money(e.balance)}</Td>
            </Tr>
          ))}
          {l.entries.length === 0 && (
            <Tr>
              <Td colSpan={6} className="text-muted-foreground">
                {t('accounts.ledgers.noEntries')}
              </Td>
            </Tr>
          )}
        </TBody>
        <tfoot className="border-t-2 bg-muted font-semibold">
          <Tr>
            <Th scope="row" colSpan={3}>
              {t('accounts.ledgers.closing')}
            </Th>
            <Td className="text-end whitespace-nowrap tabular-nums">{money(l.totalDebit)}</Td>
            <Td className="text-end whitespace-nowrap tabular-nums">{money(l.totalCredit)}</Td>
            <Td className="text-end whitespace-nowrap tabular-nums">{money(l.closingBalance)}</Td>
          </Tr>
        </tfoot>
      </Table>
    </div>
  );
}

function PartyLedgerTable({ ledger: l }: { ledger: PartyLedger }) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold break-words">{l.partyName}</h2>
      <p className="text-sm text-muted-foreground">
        {l.partyType === 'CUSTOMER'
          ? t('accounts.ledgers.customerSide')
          : t('accounts.ledgers.vendorSide')}
      </p>
      <Table>
        <caption className="sr-only">
          {t('accounts.ledgers.caption', { from: day(l.from), to: day(l.to) })}
        </caption>
        <LedgerHead />
        <TBody>
          <BalanceRow
            date={l.from}
            label={t('accounts.ledgers.opening')}
            amount={l.openingBalance}
          />
          {l.entries.map((e, i) => (
            <Tr key={`${e.journalEntryId}-${i}`}>
              <Td className="whitespace-nowrap">{day(e.date)}</Td>
              <Td>
                <SourceBadge type={e.sourceType} />
                <span className="block text-xs break-all text-muted-foreground">
                  {[e.entryNo, e.sourceNo].filter((s) => s !== null).join(' · ')}
                </span>
              </Td>
              <Td className="break-words">
                {e.narration}
                {e.against !== '' && (
                  <span className="block text-xs text-muted-foreground">
                    {t('accounts.ledgers.against', { accounts: e.against })}
                  </span>
                )}
              </Td>
              <Td className="text-end whitespace-nowrap tabular-nums">
                {e.debit === 0 ? '' : money(e.debit)}
              </Td>
              <Td className="text-end whitespace-nowrap tabular-nums">
                {e.credit === 0 ? '' : money(e.credit)}
              </Td>
              <Td className="text-end whitespace-nowrap tabular-nums">{money(e.balance)}</Td>
            </Tr>
          ))}
          {l.entries.length === 0 && (
            <Tr>
              <Td colSpan={6} className="text-muted-foreground">
                {t('accounts.ledgers.noEntries')}
              </Td>
            </Tr>
          )}
        </TBody>
        <tfoot className="border-t-2 bg-muted font-semibold">
          <Tr>
            <Th scope="row" colSpan={5}>
              {t('accounts.ledgers.closing')}
            </Th>
            <Td className="text-end whitespace-nowrap tabular-nums">{money(l.closingBalance)}</Td>
          </Tr>
        </tfoot>
      </Table>
    </div>
  );
}

function LedgerHead() {
  const { t } = useTranslation();
  return (
    <THead>
      <Tr>
        <Th>{t('accounts.ledgers.date')}</Th>
        <Th>{t('accounts.ledgers.entry')}</Th>
        <Th>{t('accounts.ledgers.particulars')}</Th>
        <Th className="text-end">{t('accounts.debit')}</Th>
        <Th className="text-end">{t('accounts.credit')}</Th>
        <Th className="text-end">{t('accounts.ledgers.balance')}</Th>
      </Tr>
    </THead>
  );
}

function BalanceRow({ date, label, amount }: { date: string; label: string; amount: number }) {
  const money = useMoney();
  const day = useDayFormat();
  return (
    <Tr className="bg-muted/40">
      <Td className="whitespace-nowrap">{day(date)}</Td>
      <Td colSpan={4} className="font-medium">
        {label}
      </Td>
      <Td className="text-end font-medium whitespace-nowrap tabular-nums">{money(amount)}</Td>
    </Tr>
  );
}
