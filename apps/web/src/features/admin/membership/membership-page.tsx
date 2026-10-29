import type { MembershipTier } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Badge,
  Button,
  Crown,
  Dialog,
  Field,
  Input,
  Pencil,
  Plus,
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
import { api, type SaveMembershipTierBody } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import {
  bpToPercent,
  paiseToRupees,
  percentToBp,
  rupeesToPaise,
  toLatinDigits,
} from '../../../lib/units';
import {
  CUSTOMER_KEYS,
  multiplierText,
  TIERS_KEY,
  useMembershipTiers,
} from '../../customers/customer-queries';
import { toast } from '../../toast/toast-store';
import { useRate } from '../../../portals/pos/bill-breakdown';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

/** /admin/membership: Silver, Gold …, reached by spend and visits. */
export function MembershipPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const rate = useRate();
  const tiers = useMembershipTiers();
  const [editing, setEditing] = useState<MembershipTier | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('membership.title')}
        description={t('membership.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('membership.add')}
          </Button>
        }
      />
      <QueryState query={tiers}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('membership.none')}</p>
          ) : (
            <Table aria-label={t('membership.title')}>
              <THead>
                <Tr>
                  <Th>{t('membership.name')}</Th>
                  <Th className="text-end">{t('membership.minSpend')}</Th>
                  <Th className="text-end">{t('membership.minVisits')}</Th>
                  <Th className="text-end">{t('membership.multiplier')}</Th>
                  <Th className="text-end">{t('membership.discount')}</Th>
                  <Th>
                    <span className="sr-only">{t('membership.actions')}</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {data.map((tier) => (
                  <Tr key={tier.id} className={tier.isActive ? undefined : 'text-muted-foreground'}>
                    <Td>
                      <span className="flex items-center gap-2 font-medium break-words">
                        <Crown
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        {tier.name}
                      </span>
                      {!tier.isActive && (
                        <Badge className="mt-1" variant="neutral">
                          {t('common.inactive')}
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-end whitespace-nowrap tabular-nums">
                      {format.money(Money.ofPaise(tier.minSpend))}
                    </Td>
                    <Td className="text-end tabular-nums">{format.number(tier.minVisits)}</Td>
                    <Td className="text-end tabular-nums">
                      {t('membership.multiplierValue', {
                        value: multiplierText(tier.pointsMultiplierBp),
                      })}
                    </Td>
                    <Td className="text-end tabular-nums">
                      {tier.discountBp === 0
                        ? t('membership.noDiscount')
                        : t('reports.dayEnd.ratePercent', { rate: rate(tier.discountBp) })}
                    </Td>
                    <Td className="text-end">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t('membership.editNamed', { name: tier.name })}
                        onClick={() => setEditing(tier)}
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
        <TierDialog tier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

interface Errors {
  name?: string;
  minSpend?: string;
  minVisits?: string;
  multiplier?: string;
  discount?: string;
}

function TierDialog({ tier, onClose }: { tier: MembershipTier | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(tier?.name ?? '');
  const [minSpend, setMinSpend] = useState(tier === null ? '' : paiseToRupees(tier.minSpend));
  const [minVisits, setMinVisits] = useState(tier === null ? '' : String(tier.minVisits));
  const [multiplier, setMultiplier] = useState(
    tier === null ? '1' : multiplierText(tier.pointsMultiplierBp),
  );
  const [discount, setDiscount] = useState(
    tier === null || tier.discountBp === 0 ? '' : bpToPercent(tier.discountBp),
  );
  const [active, setActive] = useState(tier?.isActive ?? true);
  const [errors, setErrors] = useState<Errors>({});

  const save = useMutation({
    mutationFn: (body: SaveMembershipTierBody) =>
      tier === null
        ? api.membershipTiers.create(body)
        : api.membershipTiers.update(tier.id, { ...body, isActive: active, version: tier.version }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: TIERS_KEY });
      // A guest's tier is worked out from these.
      void queryClient.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
      toast(t('membership.saved', { name: saved.name }));
      onClose();
    },
  });

  function submit() {
    const found: Errors = {};
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 40) found.name = t('membership.nameInvalid');
    const spend = minSpend.trim() === '' ? 0 : rupeesToPaise(minSpend);
    if (spend === null) found.minSpend = t('membership.amountInvalid');
    const visitsText = toLatinDigits(minVisits).trim();
    const visits = visitsText === '' ? 0 : /^\d{1,6}$/.test(visitsText) ? Number(visitsText) : null;
    if (visits === null) found.minVisits = t('membership.countInvalid');
    const times = percentToBp(toLatinDigits(multiplier));
    const multiplierBp = times === null ? null : times * 100;
    if (multiplierBp === null || multiplierBp < 0 || multiplierBp > 100_000)
      found.multiplier = t('membership.multiplierInvalid');
    const discountText = toLatinDigits(discount).trim();
    const discountBp = discountText === '' ? 0 : percentToBp(discountText);
    if (discountBp === null || discountBp < 0 || discountBp > 10_000)
      found.discount = t('membership.percentInvalid');
    setErrors(found);
    if (
      Object.keys(found).length > 0 ||
      spend === null ||
      visits === null ||
      multiplierBp === null ||
      discountBp === null
    )
      return;
    save.mutate({
      name: cleanName,
      minSpend: spend,
      minVisits: visits,
      pointsMultiplierBp: multiplierBp,
      discountBp,
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={tier === null ? t('membership.add') : t('membership.editNamed', { name: tier.name })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="tier-form" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="tier-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
          </Alert>
        )}
        <Field
          label={t('membership.name')}
          hint={t('membership.nameHint')}
          required
          error={errors.name}
        >
          {(p) => (
            <Input {...p} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('membership.minSpendLabel')}
            hint={t('membership.minSpendHint')}
            error={errors.minSpend}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                autoComplete="off"
                value={minSpend}
                onChange={(e) => setMinSpend(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('membership.minVisits')}
            hint={t('membership.minVisitsHint')}
            error={errors.minVisits}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="off"
                value={minVisits}
                onChange={(e) => setMinVisits(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('membership.multiplierLabel')}
            hint={t('membership.multiplierHint')}
            error={errors.multiplier}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                autoComplete="off"
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('membership.discountLabel')}
            hint={t('membership.discountHint')}
            error={errors.discount}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                autoComplete="off"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            )}
          </Field>
        </div>
        {tier !== null && (
          <Switch label={t('common.active')} checked={active} onCheckedChange={setActive} />
        )}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
