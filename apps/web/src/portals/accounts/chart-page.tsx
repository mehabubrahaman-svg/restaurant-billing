import type { Account, AccountType } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Pencil,
  Plus,
  Select,
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
import { Link } from 'react-router';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/confirm-dialog';
import {
  invalidateAccounting,
  useAccounts,
  useAccountsErrorMessage,
} from '../../features/accounting/accounting-queries';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { toast } from '../../features/toast/toast-store';
import { toLatinDigits } from '../../lib/units';
import { useMoney } from '../purchase/purchase-ui';
import { ACCOUNT_TYPES, BOOKS_PERMISSIONS, chartOrder, useAccountLabel } from './accounts-ui';

const CODE = /^[0-9]{3,6}$/;

/** /accounts/chart: the chart of accounts by type, with each account's balance. */
export function ChartPage() {
  const { t } = useTranslation();
  const canEdit = usePermission('accounts.journal');
  const accounts = useAccounts();
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('accounts.chart.title')}
        description={t('accounts.chart.description')}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              {t('accounts.chart.add')}
            </Button>
          ) : undefined
        }
      />
      <Checkbox
        label={t('accounts.chart.showRetired')}
        checked={showRetired}
        onChange={(e) => setShowRetired(e.target.checked)}
      />
      <QueryState query={accounts}>
        {({ data }) => (
          <div className="flex flex-col gap-5">
            {ACCOUNT_TYPES.map((type) => (
              <TypeSection
                key={type}
                type={type}
                accounts={data.filter((a) => a.type === type && (showRetired || a.isActive))}
                canEdit={canEdit}
                onEdit={setEditing}
              />
            ))}
            <p className="text-sm text-muted-foreground">{t('accounts.chart.systemNote')}</p>
          </div>
        )}
      </QueryState>
      {editing !== null && (
        <AccountDialog
          account={editing === 'new' ? null : editing}
          accounts={accounts.data?.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TypeSection({
  type,
  accounts,
  canEdit,
  onEdit,
}: {
  type: AccountType;
  accounts: readonly Account[];
  canEdit: boolean;
  onEdit: (account: Account) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useAccountsErrorMessage();
  const money = useMoney();
  const canReadBooks = usePermission(BOOKS_PERMISSIONS);
  const [retiring, setRetiring] = useState<Account | null>(null);
  const setActive = useMutation({
    mutationFn: ({ account, isActive }: { account: Account; isActive: boolean }) =>
      api.accounting.updateAccount(account.id, { version: account.version, isActive }),
    onSuccess: (saved) => {
      void invalidateAccounting(queryClient);
      toast(
        saved.isActive
          ? t('accounts.chart.restored', { name: saved.name })
          : t('accounts.chart.retired', { name: saved.name }),
      );
      setRetiring(null);
    },
  });
  const id = `chart-${type.toLowerCase()}`;
  const total = accounts.filter((a) => a.isActive).reduce((s, a) => s + a.balance, 0);
  const rows = chartOrder(accounts);

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold">
          {t(`accounts.types.${type}`)}
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t('accounts.chart.typeTotal', { amount: money(total) })}
        </span>
      </div>
      {setActive.isError && retiring === null && (
        <Alert tone="danger" role="alert">
          {errorMessage(setActive.error)}
        </Alert>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('accounts.chart.noneOfType')}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              {/* On a wide screen, fixed widths line the five tables' columns up with each other. */}
              <Th className="w-24">{t('accounts.chart.code')}</Th>
              <Th>{t('accounts.chart.name')}</Th>
              <Th className="text-end lg:w-40">{t('accounts.chart.balance')}</Th>
              {canEdit && (
                <Th className="lg:w-48">
                  <span className="sr-only">{t('purchase.actions')}</span>
                </Th>
              )}
            </Tr>
          </THead>
          <TBody>
            {rows.map(({ account: a, depth }) => (
              <Tr key={a.id} className={a.isActive ? undefined : 'text-muted-foreground'}>
                <Td className="font-mono tabular-nums">{a.code}</Td>
                <Td>
                  <span
                    className="flex flex-wrap items-center gap-2"
                    style={{ paddingInlineStart: `${depth * 1.25}rem` }}
                  >
                    {canReadBooks ? (
                      <Link
                        to={`/accounts/ledgers?account=${encodeURIComponent(a.id)}`}
                        className="font-medium break-words text-primary underline-offset-2 hover:underline"
                      >
                        {a.name}
                      </Link>
                    ) : (
                      <span className="font-medium break-words">{a.name}</span>
                    )}
                    {a.systemTag !== null && (
                      <Badge variant="outline">{t('accounts.chart.system')}</Badge>
                    )}
                    {!a.isActive && <Badge variant="neutral">{t('common.retired')}</Badge>}
                  </span>
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">{money(a.balance)}</Td>
                {canEdit && (
                  <Td className="text-end">
                    <span className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t('accounts.chart.editNamed', { name: a.name })}
                        onClick={() => onEdit(a)}
                      >
                        <Pencil aria-hidden="true" />
                        {t('common.edit')}
                      </Button>
                      {a.systemTag === null &&
                        (a.isActive ? (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={t('accounts.chart.retireNamed', { name: a.name })}
                            onClick={() => setRetiring(a)}
                          >
                            {t('common.retire')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={setActive.isPending}
                            aria-label={t('accounts.chart.restoreNamed', { name: a.name })}
                            onClick={() => setActive.mutate({ account: a, isActive: true })}
                          >
                            {t('common.restore')}
                          </Button>
                        ))}
                    </span>
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {retiring !== null && (
        <ConfirmDialog
          title={t('accounts.chart.retireTitle', { name: retiring.name })}
          body={t('accounts.chart.retireBody')}
          confirmLabel={t('common.retire')}
          destructive
          busy={setActive.isPending}
          error={setActive.isError ? errorMessage(setActive.error) : null}
          onConfirm={() => setActive.mutate({ account: retiring, isActive: false })}
          onClose={() => setRetiring(null)}
        />
      )}
    </section>
  );
}

/** Add an account (code, name, type, parent), or rename / re-parent one. */
function AccountDialog({
  account,
  accounts,
  onClose,
}: {
  account: Account | null;
  accounts: readonly Account[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useAccountsErrorMessage();
  const label = useAccountLabel();
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'EXPENSE');
  const [parentId, setParentId] = useState(account?.parentId ?? '');
  const [errors, setErrors] = useState<Partial<Record<'code' | 'name', string>>>({});
  // An account can't sit under itself or under one of its own sub-accounts.
  const below = new Set<string>(account === null ? [] : [account.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const a of accounts) {
      if (a.parentId !== null && below.has(a.parentId) && !below.has(a.id)) {
        below.add(a.id);
        grew = true;
      }
    }
  }
  const parents = chartOrder(
    accounts.filter((a) => a.type === type && a.isActive && !below.has(a.id)),
  );

  const save = useMutation({
    mutationFn: async () => {
      const found: typeof errors = {};
      const cleanCode = toLatinDigits(code).trim();
      if (account === null && !CODE.test(cleanCode)) found.code = t('accounts.chart.codeError');
      if (name.trim() === '' || name.trim().length > 120) found.name = t('validation.nameLength');
      setErrors(found);
      if (Object.keys(found).length > 0) return null;
      const parent = parentId === '' ? null : parentId;
      return account === null
        ? api.accounting.createAccount({
            code: cleanCode,
            name: name.trim(),
            type,
            parentId: parent,
          })
        : api.accounting.updateAccount(account.id, {
            version: account.version,
            name: name.trim(),
            parentId: parent,
          });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void invalidateAccounting(queryClient);
      toast(t('accounts.chart.saved', { name: saved.name }));
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, 'ACCOUNT_CODE_TAKEN'))
        setErrors((e) => ({ ...e, code: t('accounts.errors.accountCodeTaken') }));
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={
        account === null
          ? t('accounts.chart.add')
          : t('accounts.chart.editNamed', { name: account.name })
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="account-form" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="account-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          {account === null ? (
            <Field
              label={t('accounts.chart.code')}
              hint={t('accounts.chart.codeHint')}
              required
              error={errors.code}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  className="font-mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('accounts.chart.code')}</span>
              <span className="flex min-h-touch items-center font-mono">{account.code}</span>
            </div>
          )}
          <Field label={t('accounts.chart.name')} required error={errors.name}>
            {(p) => (
              <Input
                {...p}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
        </div>
        {account === null ? (
          <Field label={t('accounts.chart.type')} hint={t(`accounts.typeHints.${type}`)}>
            {(p) => (
              <Select
                {...p}
                value={type}
                onChange={(e) => {
                  setType(e.target.value as AccountType);
                  setParentId('');
                }}
              >
                {ACCOUNT_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`accounts.types.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('accounts.chart.type')}</span>
            <span>{t(`accounts.types.${account.type}`)}</span>
            {account.systemTag !== null && (
              <span className="text-sm text-muted-foreground">
                {t('accounts.chart.systemEdit')}
              </span>
            )}
          </div>
        )}
        <Field label={t('accounts.chart.parent')} hint={t('accounts.chart.parentHint')}>
          {(p) => (
            <Select {...p} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">{t('accounts.chart.noParent')}</option>
              {parents.map(({ account: a, depth }) => (
                <option key={a.id} value={a.id}>
                  {`${'  '.repeat(depth)}${label(a)}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
