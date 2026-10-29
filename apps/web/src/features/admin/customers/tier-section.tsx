import type { CustomerDetail, GuestTier } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { Alert, Button, Card, Field, Select } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { useRate } from '../../../portals/pos/bill-breakdown';
import { usePermission } from '../../auth/permissions';
import {
  CUSTOMER_KEYS,
  multiplierText,
  useMembershipTiers,
} from '../../customers/customer-queries';
import { TierBadge } from '../../customers/tier-badge';
import { toast } from '../../toast/toast-store';

/** What a tier gives: "10% off every bill · points ×1.5". */
export function useTierBenefits() {
  const { t } = useTranslation();
  const rate = useRate();
  return (tier: Pick<GuestTier, 'discountBp' | 'pointsMultiplierBp'>) => {
    const parts = [
      tier.discountBp > 0 && t('customers.tier.benefitDiscount', { rate: rate(tier.discountBp) }),
      tier.pointsMultiplierBp !== 10_000 &&
        t('customers.tier.benefitPoints', { value: multiplierText(tier.pointsMultiplierBp) }),
    ].filter((p): p is string => typeof p === 'string');
    return parts.length === 0 ? t('customers.tier.noBenefits') : parts.join(' · ');
  };
}

/** On a guest's page: their tier, what the next one needs, and (loyalty.adjust) a tier by hand. */
export function TierSection({ customer }: { customer: CustomerDetail }) {
  const { t } = useTranslation();
  const format = useFormat();
  const benefits = useTierBenefits();
  const canPin = usePermission('loyalty.adjust');
  const tiers = useMembershipTiers();
  const active = (tiers.data?.data ?? []).filter((x) => x.isActive);
  const { tier, nextTier } = customer;

  return (
    <section aria-labelledby="cust-tier" className="flex flex-col gap-2">
      <h2 id="cust-tier" className="font-semibold">
        {t('customers.tier.title')}
      </h2>
      <Card className="flex flex-col gap-3 p-4">
        {tier === null ? (
          <p className="text-muted-foreground">{t('customers.tier.none')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={tier} />
            <span className="text-sm text-muted-foreground">
              {tier.pinned ? t('customers.tier.pinned') : t('customers.tier.reached')}
            </span>
            <span className="text-sm">{benefits(tier)}</span>
          </div>
        )}
        {nextTier !== null ? (
          <p className="text-sm">
            {[
              t('customers.tier.next', { name: nextTier.name }),
              nextTier.spendNeeded > 0 &&
                t('customers.tier.needSpend', {
                  amount: format.money(Money.ofPaise(nextTier.spendNeeded)),
                }),
              nextTier.visitsNeeded > 0 &&
                t('customers.tier.needVisits', { count: nextTier.visitsNeeded }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : (
          tier !== null &&
          !tier.pinned && <p className="text-sm text-muted-foreground">{t('customers.tier.top')}</p>
        )}
        {tiers.isSuccess && active.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('customers.tier.noTiers')}</p>
        )}
        {canPin && active.length > 0 && (
          <PinTier customer={customer} options={active.map((x) => ({ id: x.id, name: x.name }))} />
        )}
      </Card>
    </section>
  );
}

function PinTier({
  customer,
  options,
}: {
  customer: CustomerDetail;
  options: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [choice, setChoice] = useState(customer.membershipTierId ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.customers.update(customer.id, {
        membershipTierId: choice === '' ? null : choice,
        version: customer.version,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
      toast(t('customers.tier.saved'));
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label={t('customers.tier.choose')} hint={t('customers.tier.chooseHint')}>
        {(p) => (
          <Select {...p} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{t('customers.tier.auto')}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button
        type="submit"
        variant="outline"
        disabled={save.isPending || choice === (customer.membershipTierId ?? '')}
      >
        {save.isPending ? t('common.saving') : t('common.save')}
      </Button>
      {save.isError && (
        <Alert tone="danger" role="alert" className="w-full">
          {errorMessage(save.error)}
        </Alert>
      )}
    </form>
  );
}
