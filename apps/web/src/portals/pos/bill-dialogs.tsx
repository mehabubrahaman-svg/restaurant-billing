import { Money } from '@restroos/domain';
import {
  Alert,
  Button,
  Check,
  Dialog,
  Field,
  Input,
  SegmentedControl,
  Spinner,
} from '@restroos/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { exceedsLimit, type BillOptions } from '../../features/billing/bill-options';
import {
  formatPhone,
  searchTerm,
  useCustomerSearch,
} from '../../features/customers/customer-queries';
import { TierBadge } from '../../features/customers/tier-badge';
import { useFormat } from '../../i18n/use-format';
import { gstinProblem } from '../../features/setup/gstin';
import {
  bpToPercent,
  paiseToRupees,
  percentToBp,
  rupeesToPaise,
  toLatinDigits,
} from '../../lib/units';
import { useRate } from './bill-breakdown';

type Discount = NonNullable<BillOptions['discount']>;

/** A small form dialog: Enter applies, Esc closes. */
function FormDialog({
  title,
  description,
  onClose,
  onSubmit,
  submitLabel,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const formId = `form-${title.length}-${submitLabel.length}`;
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      closeLabel={t('common.close')}
      title={title}
      {...(description === undefined ? {} : { description })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
        {/* Enter in a field submits even though the buttons sit outside the form. */}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

const QUICK_REASONS = ['regular', 'staff', 'complaint', 'festival'] as const;

/** % or ₹ off the bill, with a reason; warns when a manager will have to approve it. */
export function DiscountDialog({
  current,
  subtotal,
  limitBp,
  canOverride,
  onApply,
  onClose,
}: {
  current: Discount | null;
  subtotal: number;
  /** Branch limit; null while unknown. */
  limitBp: number | null;
  canOverride: boolean;
  onApply: (discount: Discount) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rate = useRate();
  const [kind, setKind] = useState<Discount['kind']>(current?.kind ?? 'PERCENT');
  const [value, setValue] = useState(
    current === null
      ? ''
      : current.kind === 'PERCENT'
        ? bpToPercent(current.value)
        : paiseToRupees(current.value),
  );
  const [reason, setReason] = useState(current?.reason ?? '');
  const reasonRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<{ value?: string; reason?: string }>({});

  const parsed = kind === 'PERCENT' ? percentToBp(value) : rupeesToPaise(value);
  const valid =
    parsed !== null &&
    parsed > 0 &&
    (kind === 'PERCENT' ? parsed <= 10_000 : subtotal <= 0 || parsed <= subtotal);
  const draft: Discount | null = valid ? { kind, value: parsed, reason } : null;
  const needsApproval =
    draft !== null && limitBp !== null && !canOverride && exceedsLimit(draft, subtotal, limitBp);

  function submit() {
    const found: typeof errors = {};
    if (draft === null) found.value = t('pos.discount.invalid');
    if (reason.trim().length < 3) found.reason = t('pos.discount.reasonRequired');
    setErrors(found);
    if (draft !== null && found.reason === undefined) onApply({ ...draft, reason: reason.trim() });
  }

  return (
    <FormDialog
      title={t('pos.discount.title')}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={t('pos.discount.apply')}
    >
      <SegmentedControl<Discount['kind']>
        aria-label={t('pos.discount.kind')}
        value={kind}
        onValueChange={(k) => {
          setKind(k);
          setValue('');
        }}
        options={[
          { value: 'PERCENT', label: t('pos.discount.percent') },
          { value: 'FIXED', label: t('pos.discount.fixed') },
        ]}
      />
      <Field
        label={kind === 'PERCENT' ? t('pos.discount.percentLabel') : t('pos.discount.amountLabel')}
        error={errors.value}
        hint={limitBp === null ? undefined : t('pos.discount.limitHint', { rate: rate(limitBp) })}
      >
        {(p) => (
          <Input
            {...p}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('pos.discount.reason')} error={errors.reason} required>
        {(p) => (
          <Input
            {...p}
            ref={reasonRef}
            value={reason}
            maxLength={120}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('pos.discount.quick')}>
        {QUICK_REASONS.map((r) => (
          <Button
            key={r}
            size="sm"
            variant="outline"
            aria-pressed={reason === t(`pos.discount.reasons.${r}`)}
            onClick={() => {
              setReason(t(`pos.discount.reasons.${r}`));
              // Back to the field, so Enter applies the discount.
              reasonRef.current?.focus();
            }}
          >
            {t(`pos.discount.reasons.${r}`)}
          </Button>
        ))}
      </div>
      {needsApproval && (
        <Alert tone="warning">{t('pos.discount.needsApproval', { rate: rate(limitBp) })}</Alert>
      )}
    </FormDialog>
  );
}

export function CouponDialog({
  current,
  onApply,
  onClose,
}: {
  current: string | null;
  onApply: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(current ?? '');
  const [error, setError] = useState(false);
  return (
    <FormDialog
      title={t('pos.coupon.title')}
      onClose={onClose}
      submitLabel={t('pos.coupon.apply')}
      onSubmit={() => {
        const clean = code.trim().toUpperCase();
        setError(clean === '' || clean.length > 32);
        if (clean !== '' && clean.length <= 32) onApply(clean);
      }}
    >
      <Field label={t('pos.coupon.code')} error={error ? t('pos.coupon.required') : undefined}>
        {(p) => (
          <Input
            {...p}
            autoComplete="off"
            autoCapitalize="characters"
            className="uppercase"
            value={code}
            maxLength={32}
            onChange={(e) => setCode(e.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}

export function ComplimentaryDialog({
  current,
  canGive,
  onApply,
  onClose,
}: {
  current: string | null;
  canGive: boolean;
  onApply: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState(current ?? '');
  const [error, setError] = useState(false);
  return (
    <FormDialog
      title={t('pos.comp.title')}
      description={t('pos.comp.description')}
      onClose={onClose}
      submitLabel={t('pos.comp.apply')}
      onSubmit={() => {
        const ok = reason.trim().length >= 3;
        setError(!ok);
        if (ok) onApply(reason.trim());
      }}
    >
      <Field
        label={t('pos.comp.reason')}
        error={error ? t('pos.discount.reasonRequired') : undefined}
        required
      >
        {(p) => (
          <Input
            {...p}
            value={reason}
            maxLength={120}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      {!canGive && <Alert tone="warning">{t('pos.comp.needsApproval')}</Alert>}
    </FormDialog>
  );
}

/** The guest's name and, for a business (B2B) tax invoice, their GSTIN. */
export function CustomerDialog({
  current,
  onApply,
  onClose,
}: {
  current: BillOptions['customer'];
  onApply: (customer: NonNullable<BillOptions['customer']> | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(current?.name ?? '');
  const [taxId, setTaxId] = useState(current?.taxId ?? '');
  const [phone, setPhone] = useState(current?.phone ?? '');
  const [phoneError, setPhoneError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const format = useFormat();
  const search = useCustomerSearch(phone);
  const matches = search.enabled ? (search.data?.data ?? []).slice(0, 5) : [];
  const typed = searchTerm(phone).slice(-10);
  const fullNumber = /^[6-9]\d{9}$/.test(typed);
  const exact = fullNumber ? matches.find((c) => c.phone.slice(-10) === typed) : undefined;
  const filledFor = useRef<string | null>(null);
  // A known guest's full number: fill in their name and GSTIN (once, so edits stick).
  useEffect(() => {
    if (exact === undefined || filledFor.current === exact.id) return;
    filledFor.current = exact.id;
    setName((n) => (n.trim() === '' ? (exact.name ?? '') : n));
    setTaxId((g) => (g.trim() === '' ? (exact.taxId ?? '') : g));
  }, [exact]);
  return (
    <FormDialog
      title={t('pos.customer.title')}
      onClose={onClose}
      submitLabel={t('pos.customer.apply')}
      onSubmit={() => {
        const gstin = taxId.trim().toUpperCase();
        // Any state's GSTIN is fine for a guest; only the shape and check digit are checked.
        const problem = gstin === '' ? null : gstinProblem(gstin, '');
        setError(problem === null ? null : t('setup.errors.gstinFormat'));
        const mobile = toLatinDigits(phone).replaceAll(/[\s-]/g, '');
        const badPhone = mobile !== '' && !/^(\+91|91|0)?[6-9]\d{9}$/.test(mobile);
        setPhoneError(badPhone);
        if (problem !== null || badPhone) return;
        onApply(
          name.trim() === '' && gstin === '' && mobile === ''
            ? null
            : { name: name.trim(), phone: mobile, taxId: gstin },
        );
      }}
    >
      <Field
        label={t('pos.customer.phone')}
        hint={t('pos.customer.phoneHint')}
        error={phoneError ? t('pos.customer.phoneInvalid') : undefined}
      >
        {(p) => (
          <Input
            {...p}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={16}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>
      {search.enabled && search.isFetching && matches.length === 0 && (
        <Spinner label={t('pos.customer.searching')} className="size-4" />
      )}
      {matches.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p id="customer-matches" className="text-sm font-medium">
            {t('pos.customer.matches')}
          </p>
          <ul aria-labelledby="customer-matches" className="flex flex-col gap-1.5">
            {matches.map((c) => {
              const chosen = c.phone.slice(-10) === typed;
              return (
                <li key={c.id}>
                  <Button
                    variant="outline"
                    aria-pressed={chosen}
                    className="h-auto w-full justify-start py-2 text-start"
                    onClick={() => {
                      setPhone(formatPhone(c.phone));
                      setName(c.name ?? '');
                      setTaxId(c.taxId ?? '');
                      setPhoneError(false);
                    }}
                  >
                    {chosen && <Check aria-hidden="true" />}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex flex-wrap items-center gap-2 font-semibold break-words">
                        {c.name ?? t('pos.customer.noName')}
                        <TierBadge tier={c.tier} />
                      </span>
                      <span className="text-sm font-normal text-muted-foreground tabular-nums">
                        {t('pos.customer.matchDetail', {
                          phone: formatPhone(c.phone),
                          count: c.visitCount,
                          spend: format.money(Money.ofPaise(c.lifetimeValue)),
                        })}
                      </span>
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {search.enabled &&
        !search.isFetching &&
        search.isSuccess &&
        matches.length === 0 &&
        fullNumber && (
          <p className="text-sm text-muted-foreground" role="status">
            {t('pos.customer.newGuest')}
          </p>
        )}
      <Field label={t('pos.customer.name')}>
        {(p) => (
          <Input
            {...p}
            autoComplete="off"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field
        label={t('pos.customer.gstin')}
        hint={t('pos.customer.gstinHint')}
        error={error ?? undefined}
      >
        {(p) => (
          <Input
            {...p}
            autoComplete="off"
            className="uppercase"
            maxLength={15}
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}
