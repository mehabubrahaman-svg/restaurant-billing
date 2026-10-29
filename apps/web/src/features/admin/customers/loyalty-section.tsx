import type { LoyaltyEntry } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Button,
  Card,
  Dialog,
  Field,
  Gift,
  Input,
  SegmentedControl,
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
import { api } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { toLatinDigits } from '../../../lib/units';
import { usePermission } from '../../auth/permissions';
import { CUSTOMER_KEYS, useLoyalty } from '../../customers/customer-queries';
import { toast } from '../../toast/toast-store';
import { QueryState } from '../query-state';

/** The guest's loyalty points: balance, what it is worth, history, and a manager's adjustment. */
export function LoyaltySection({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const ledger = useLoyalty(customerId);
  const canAdjust = usePermission('loyalty.adjust');
  const [adjusting, setAdjusting] = useState(false);

  return (
    <section aria-labelledby="cust-loyalty" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cust-loyalty" className="flex items-center gap-2 font-semibold">
          <Gift aria-hidden="true" className="size-5 text-muted-foreground" />
          {t('customers.loyalty.title')}
        </h2>
        {canAdjust && (
          <Button variant="outline" size="sm" onClick={() => setAdjusting(true)}>
            {t('customers.loyalty.adjust')}
          </Button>
        )}
      </div>
      <QueryState query={ledger}>
        {(data) => (
          <>
            <Card className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4">
              <span className="text-2xl font-bold tabular-nums">
                {t('customers.loyalty.points', { count: data.balance })}
              </span>
              <span className="text-muted-foreground">
                {t('customers.loyalty.worth', {
                  amount: format.money(Money.ofPaise(data.balance * data.program.pointValue)),
                })}
              </span>
              {!data.program.enabled && (
                <span className="text-sm text-muted-foreground">{t('customers.loyalty.off')}</span>
              )}
            </Card>
            {data.entries.length === 0 ? (
              <p className="text-muted-foreground">{t('customers.loyalty.none')}</p>
            ) : (
              <LoyaltyTable entries={data.entries} />
            )}
          </>
        )}
      </QueryState>
      {adjusting && (
        <AdjustDialog
          customerId={customerId}
          balance={ledger.data?.balance ?? 0}
          onClose={() => setAdjusting(false)}
        />
      )}
    </section>
  );
}

function LoyaltyTable({ entries }: { entries: readonly LoyaltyEntry[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <Table aria-label={t('customers.loyalty.history')}>
      <THead>
        <Tr>
          <Th>{t('customers.date')}</Th>
          <Th>{t('customers.loyalty.what')}</Th>
          <Th className="text-end">{t('customers.loyalty.change')}</Th>
        </Tr>
      </THead>
      <TBody>
        {entries.map((e) => (
          <Tr key={e.id}>
            <Td className="whitespace-nowrap">
              {format.dateTime(e.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
            </Td>
            <Td className="break-words">
              {t(`customers.loyalty.kinds.${e.kind}`)}
              {e.invoiceNo !== null && (
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {e.invoiceNo}
                </span>
              )}
              {e.note !== null && (
                <span className="block text-xs text-muted-foreground">
                  {e.note}
                  {e.createdByName !== null && ` · ${e.createdByName}`}
                </span>
              )}
            </Td>
            <Td
              className={`text-end font-semibold whitespace-nowrap tabular-nums ${e.points < 0 ? 'text-state-danger-fg' : 'text-state-available-fg'}`}
            >
              {e.points > 0 ? '+' : '−'}
              {format.number(Math.abs(e.points))}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

/** A manager adds points (a goodwill gift) or takes them away (a mistake), with why. */
function AdjustDialog({
  customerId,
  balance,
  onClose,
}: {
  customerId: string;
  balance: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ points?: boolean; note?: boolean }>({});

  const save = useMutation({
    mutationFn: async () => {
      const text = toLatinDigits(points).trim();
      const n = /^\d{1,6}$/.test(text) ? Number(text) : 0;
      const found = {
        ...(n < 1 || (direction === 'remove' && n > balance) ? { points: true } : {}),
        ...(note.trim().length < 3 ? { note: true } : {}),
      };
      setErrors(found);
      if (Object.keys(found).length > 0) return null;
      return api.customers.adjustLoyalty(customerId, {
        points: direction === 'add' ? n : -n,
        note: note.trim(),
      });
    },
    onSuccess: (ledger) => {
      if (ledger === null) return;
      queryClient.setQueryData(CUSTOMER_KEYS.loyalty(customerId), ledger);
      void queryClient.invalidateQueries({ queryKey: CUSTOMER_KEYS.detail(customerId) });
      toast(t('customers.loyalty.saved', { count: ledger.balance }));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={t('customers.loyalty.adjustTitle')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          {t('customers.loyalty.balanceNow', { count: balance })}
        </p>
        <SegmentedControl<'add' | 'remove'>
          aria-label={t('customers.loyalty.direction')}
          value={direction}
          onValueChange={setDirection}
          options={[
            { value: 'add', label: t('customers.loyalty.addPoints') },
            { value: 'remove', label: t('customers.loyalty.removePoints') },
          ]}
        />
        <Field
          label={t('customers.loyalty.pointsLabel')}
          required
          error={
            errors.points === true
              ? direction === 'remove'
                ? t('customers.loyalty.removeError', { count: balance })
                : t('customers.loyalty.pointsError')
              : undefined
          }
        >
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              autoComplete="off"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('customers.loyalty.note')}
          hint={t('customers.loyalty.noteHint')}
          required
          error={errors.note === true ? t('customers.loyalty.noteError') : undefined}
        >
          {(p) => (
            <Input
              {...p}
              maxLength={200}
              autoComplete="off"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
