import type { Coupon } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Pencil,
  Plus,
  SegmentedControl,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type SaveCouponBody } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { bpToPercent, paiseToRupees, percentToBp, rupeesToPaise } from '../../../lib/units';
import { toast } from '../../toast/toast-store';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

const COUPONS_KEY = ['coupons'] as const;

/** Settings → Coupons: codes the cashier types on the POS (percent or ₹ off, with limits). */
export function CouponsPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const coupons = useQuery({ queryKey: COUPONS_KEY, queryFn: api.coupons.list });
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const money = (paise: number) => format.money(Money.ofPaise(paise));

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('coupons.title')}
        description={t('coupons.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('coupons.add')}
          </Button>
        }
      />
      <QueryState query={coupons}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('coupons.empty')}</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t('coupons.code')}</Th>
                  <Th>{t('coupons.value')}</Th>
                  <Th>{t('coupons.rules')}</Th>
                  <Th>{t('coupons.used')}</Th>
                  <Th>{t('users.status')}</Th>
                  <Th>
                    <span className="sr-only">{t('users.actions')}</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {data.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-mono font-medium">{c.code}</Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {c.kind === 'PERCENT'
                        ? t('charges.percentValue', { rate: bpToPercent(c.value) })
                        : money(c.value)}
                    </Td>
                    <Td className="text-sm text-muted-foreground">
                      {[
                        c.maxDiscount === null
                          ? null
                          : t('coupons.upTo', { amount: money(c.maxDiscount) }),
                        c.minBill > 0
                          ? t('coupons.minBillShort', { amount: money(c.minBill) })
                          : null,
                        c.validFrom === null && c.validTo === null
                          ? null
                          : t('coupons.validRange', {
                              from: c.validFrom ?? '…',
                              to: c.validTo ?? '…',
                            }),
                      ]
                        .filter((x) => x !== null)
                        .join(' · ')}
                    </Td>
                    <Td className="tabular-nums">
                      {c.usageLimit === null
                        ? format.number(c.usedCount)
                        : t('coupons.usedOf', { used: c.usedCount, limit: c.usageLimit })}
                    </Td>
                    <Td>
                      <Badge variant={c.isActive ? 'success' : 'neutral'}>
                        {c.isActive ? t('common.active') : t('common.inactive')}
                      </Badge>
                    </Td>
                    <Td className="text-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-touch"
                        aria-label={t('coupons.editNamed', { code: c.code })}
                        onClick={() => setEditing(c)}
                      >
                        <Pencil aria-hidden="true" />
                        {t('common.edit')}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )
        }
      </QueryState>
      {editing !== null && (
        <CouponDialog
          coupon={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function CouponDialog({ coupon, onClose }: { coupon: Coupon | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [code, setCode] = useState(coupon?.code ?? '');
  const [kind, setKind] = useState<'PERCENT' | 'FIXED'>(coupon?.kind ?? 'PERCENT');
  const [value, setValue] = useState(
    coupon === null
      ? ''
      : coupon.kind === 'PERCENT'
        ? bpToPercent(coupon.value)
        : paiseToRupees(coupon.value),
  );
  const [maxDiscount, setMaxDiscount] = useState(
    coupon === null || coupon.maxDiscount === null ? '' : paiseToRupees(coupon.maxDiscount),
  );
  const [minBill, setMinBill] = useState(
    coupon === null || coupon.minBill === 0 ? '' : paiseToRupees(coupon.minBill),
  );
  const [validFrom, setValidFrom] = useState(coupon?.validFrom ?? '');
  const [validTo, setValidTo] = useState(coupon?.validTo ?? '');
  const [usageLimit, setUsageLimit] = useState(
    coupon === null || coupon.usageLimit === null ? '' : String(coupon.usageLimit),
  );
  const [active, setActive] = useState(coupon?.isActive ?? true);
  const [errors, setErrors] = useState<
    Partial<Record<'code' | 'value' | 'maxDiscount' | 'minBill' | 'dates' | 'usageLimit', string>>
  >({});

  const save = useMutation({
    mutationFn: async () => {
      const found: typeof errors = {};
      const clean = code.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,32}$/.test(clean)) found.code = t('coupons.codeError');
      const amount = kind === 'PERCENT' ? percentToBp(value) : rupeesToPaise(value);
      if (amount === null || amount <= 0 || (kind === 'PERCENT' && amount > 10_000)) {
        found.value = kind === 'PERCENT' ? t('validation.percent') : t('validation.amount');
      }
      const max = maxDiscount.trim() === '' ? null : rupeesToPaise(maxDiscount);
      if (maxDiscount.trim() !== '' && (max === null || max <= 0))
        found.maxDiscount = t('validation.amount');
      const min = minBill.trim() === '' ? 0 : rupeesToPaise(minBill);
      if (min === null) found.minBill = t('validation.amount');
      if (
        (validFrom !== '' && !DAY.test(validFrom)) ||
        (validTo !== '' && !DAY.test(validTo)) ||
        (validFrom !== '' && validTo !== '' && validTo < validFrom)
      ) {
        found.dates = t('coupons.datesError');
      }
      const limit = usageLimit.trim() === '' ? null : Number(usageLimit.trim());
      if (limit !== null && (!Number.isInteger(limit) || limit <= 0))
        found.usageLimit = t('coupons.limitError');
      setErrors(found);
      if (Object.keys(found).length > 0 || amount === null || min === null) return null;
      const body: SaveCouponBody = {
        code: clean,
        kind,
        value: amount,
        maxDiscount: kind === 'PERCENT' ? max : null,
        minBill: min,
        validFrom: validFrom === '' ? null : validFrom,
        validTo: validTo === '' ? null : validTo,
        usageLimit: limit,
      };
      return coupon === null
        ? api.coupons.create(body)
        : api.coupons.update(coupon.id, { ...body, isActive: active, version: coupon.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: COUPONS_KEY });
      toast(t('coupons.saved', { code: saved.code }));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={coupon === null ? t('coupons.add') : t('coupons.editNamed', { code: coupon.code })}
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
      <form
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
        <Field label={t('coupons.code')} hint={t('coupons.codeHint')} required error={errors.code}>
          {(p) => (
            <Input
              {...p}
              className="font-mono uppercase"
              autoComplete="off"
              maxLength={32}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('charges.kind')}</span>
          <SegmentedControl<'PERCENT' | 'FIXED'>
            aria-label={t('charges.kind')}
            value={kind}
            onValueChange={(k) => {
              setKind(k);
              setValue('');
            }}
            options={[
              { value: 'PERCENT', label: t('charges.percent') },
              { value: 'FIXED', label: t('charges.fixed') },
            ]}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={kind === 'PERCENT' ? t('taxes.ratePercent') : t('charges.amount')}
            required
            error={errors.value}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </Field>
          {kind === 'PERCENT' && (
            <Field
              label={t('coupons.maxDiscount')}
              hint={t('coupons.optionalHint')}
              error={errors.maxDiscount}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field
            label={t('coupons.minBill')}
            hint={t('coupons.optionalHint')}
            error={errors.minBill}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={minBill}
                onChange={(e) => setMinBill(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('coupons.usageLimit')}
            hint={t('coupons.optionalHint')}
            error={errors.usageLimit}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('coupons.validFrom')} error={errors.dates}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('coupons.validTo')}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
            )}
          </Field>
        </div>
        {coupon !== null && (
          <Switch label={t('common.active')} checked={active} onCheckedChange={setActive} />
        )}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
