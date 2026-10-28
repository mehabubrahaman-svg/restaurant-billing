import type { IndianState } from '@restroos/contracts';
import { Alert, Button, Checkbox, Field, Input, Select, Switch, Textarea, cn } from '@restroos/ui';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { LOCALE_OPTIONS, type AppLocale } from '../../i18n/config';
import { tDynamic } from '../../lib/dynamic-t';
import {
  RECEIPT_LANGUAGES,
  type ReceiptLanguage,
  type SetupErrors,
  type SetupForm,
} from './setup-form';

export interface StepProps {
  readonly form: SetupForm;
  readonly errors: SetupErrors;
  readonly update: (patch: Partial<SetupForm>) => void;
  readonly states: readonly IndianState[];
}

/** Region order in the state picker (north and east first: wave 1). */
const REGION_ORDER = ['NORTH', 'EAST', 'NORTH_EAST', 'CENTRAL', 'WEST', 'SOUTH', 'ISLANDS'];

export function stateName(t: TFunction, state: IndianState): string {
  return tDynamic(t, `states.${state.gstStateCode}`, state.name);
}

function useErr(errors: SetupErrors) {
  const { t } = useTranslation();
  return (field: keyof SetupForm) => {
    const key = errors[field];
    return key === undefined ? undefined : t(key);
  };
}

export function LanguageStep({ form, update }: StepProps) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">{t('setup.language.body')}</p>
      <div role="radiogroup" aria-label={t('language.label')} className="grid gap-3 sm:grid-cols-3">
        {LOCALE_OPTIONS.map((o) => {
          const checked = form.locale === o.code;
          return (
            <button
              key={o.code}
              type="button"
              role="radio"
              aria-checked={checked}
              lang={o.code}
              onClick={() => {
                update({ locale: o.code as AppLocale });
                void i18n.changeLanguage(o.code);
              }}
              className={cn(
                'flex min-h-20 items-center justify-center rounded-xl border-2 p-4 text-xl font-semibold transition-colors',
                checked ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BusinessStep({ form, errors, update, states }: StepProps) {
  const { t } = useTranslation();
  const err = useErr(errors);
  const regions = [...new Set(states.map((s) => s.region))].sort(
    (a, b) => ((REGION_ORDER.indexOf(a) + 99) % 99) - ((REGION_ORDER.indexOf(b) + 99) % 99),
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field
        label={t('setup.business.orgName')}
        hint={t('setup.business.orgNameHint')}
        required
        error={err('orgName')}
      >
        {(p) => (
          <Input
            {...p}
            value={form.orgName}
            onChange={(e) => update({ orgName: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('setup.business.legalName')} hint={t('common.optional')}>
        {(p) => (
          <Input
            {...p}
            value={form.legalName}
            onChange={(e) => update({ legalName: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('setup.business.branchName')} required error={err('branchName')}>
        {(p) => (
          <Input
            {...p}
            value={form.branchName}
            onChange={(e) => update({ branchName: e.target.value })}
          />
        )}
      </Field>
      <Field
        label={t('setup.business.branchCode')}
        hint={t('setup.business.branchCodeHint')}
        required
        error={err('branchCode')}
      >
        {(p) => (
          <Input
            {...p}
            value={form.branchCode}
            maxLength={8}
            autoCapitalize="characters"
            onChange={(e) => update({ branchCode: e.target.value.toUpperCase() })}
          />
        )}
      </Field>
      <Field
        label={t('setup.business.state')}
        required
        error={err('stateCode')}
        className="md:col-span-2"
      >
        {(p) => (
          <Select
            {...p}
            value={form.stateCode}
            onChange={(e) => update({ stateCode: e.target.value })}
          >
            <option value="">{t('setup.business.statePlaceholder')}</option>
            {regions.map((region) => (
              <optgroup key={region} label={tDynamic(t, `regions.${region}`, region)}>
                {states
                  .filter((s) => s.region === region)
                  .map((s) => (
                    <option key={s.gstStateCode} value={s.gstStateCode}>
                      {`${stateName(t, s)} (${s.gstStateCode})`}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={t('setup.business.gstin')}
        hint={t('setup.business.gstinHint')}
        error={err('gstin')}
        className="md:col-span-2"
      >
        {(p) => (
          <Input
            {...p}
            value={form.gstin}
            maxLength={15}
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono tracking-wider"
            onChange={(e) => update({ gstin: e.target.value.toUpperCase() })}
          />
        )}
      </Field>
      <Field
        label={t('setup.business.address')}
        hint={t('common.optional')}
        className="md:col-span-2"
      >
        {(p) => (
          <Textarea
            {...p}
            rows={2}
            value={form.address}
            onChange={(e) => update({ address: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('setup.business.phone')} hint={t('common.optional')}>
        {(p) => (
          <Input
            {...p}
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => update({ phone: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

export function LiquorStep({ form, errors, update, states }: StepProps) {
  const { t } = useTranslation();
  const err = useErr(errors);
  const state = states.find((s) => s.gstStateCode === form.stateCode);
  const prohibited = state !== undefined && !state.liquorPermitted;
  const canEnable = !prohibited || form.overrideProhibition;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t('setup.liquor.body')}</p>
      {prohibited && (
        <Alert
          tone="warning"
          title={t('setup.liquor.prohibitedTitle', { state: stateName(t, state) })}
        >
          <p>{t('setup.liquor.prohibitedBody')}</p>
          <Checkbox
            className="mt-1"
            label={t('setup.liquor.override')}
            checked={form.overrideProhibition}
            onChange={(e) =>
              update({
                overrideProhibition: e.target.checked,
                ...(e.target.checked ? {} : { liquorEnabled: false }),
              })
            }
          />
        </Alert>
      )}
      <Switch
        label={t('setup.liquor.enable')}
        description={t('setup.liquor.enableHint')}
        checked={form.liquorEnabled}
        disabled={!canEnable}
        onCheckedChange={(on) =>
          update({ liquorEnabled: on, separateInvoice: state?.liquorSeparateInvoice ?? false })
        }
      />
      {errors.liquorEnabled !== undefined && (
        <Alert tone="danger" role="alert">
          {t(errors.liquorEnabled)}
        </Alert>
      )}
      {form.liquorEnabled && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('setup.liquor.vatTin')} required error={err('vatTin')}>
            {(p) => (
              <Input
                {...p}
                value={form.vatTin}
                onChange={(e) => update({ vatTin: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('setup.liquor.excise')} required error={err('exciseLicenceNo')}>
            {(p) => (
              <Input
                {...p}
                value={form.exciseLicenceNo}
                onChange={(e) => update({ exciseLicenceNo: e.target.value })}
              />
            )}
          </Field>
          <Alert tone="info" className="md:col-span-2">
            {t('setup.liquor.advisor')}
          </Alert>
          <Field label={t('setup.liquor.vatPercent')} required error={err('vatPercent')}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={form.vatPercent}
                onChange={(e) => update({ vatPercent: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('setup.liquor.surchargePercent')}
            hint={t('common.optional')}
            error={err('surchargePercent')}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={form.surchargePercent}
                onChange={(e) => update({ surchargePercent: e.target.value })}
              />
            )}
          </Field>
          <Switch
            className="md:col-span-2"
            label={t('setup.liquor.separate')}
            description={t('setup.liquor.separateHint')}
            checked={form.separateInvoice}
            onCheckedChange={(on) => update({ separateInvoice: on })}
          />
        </div>
      )}
    </div>
  );
}

const LANGUAGE_NAMES: Record<ReceiptLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
  bn: 'বাংলা',
};

export function ReceiptStep({ form, errors, update }: StepProps) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-muted-foreground">{t('setup.receipt.body')}</legend>
      {RECEIPT_LANGUAGES.map((lang) => {
        const checked = form.receiptLanguages.includes(lang);
        return (
          <Checkbox
            key={lang}
            label={<span lang={lang}>{LANGUAGE_NAMES[lang]}</span>}
            checked={checked}
            disabled={!checked && form.receiptLanguages.length >= 2}
            onChange={(e) =>
              update({
                receiptLanguages: e.target.checked
                  ? [...form.receiptLanguages, lang]
                  : form.receiptLanguages.filter((l) => l !== lang),
              })
            }
          />
        );
      })}
      {errors.receiptLanguages !== undefined && (
        <p role="alert" className="text-sm font-medium text-state-danger-fg">
          {t(errors.receiptLanguages)}
        </p>
      )}
    </fieldset>
  );
}

export function AdminStep({ form, errors, update }: StepProps) {
  const { t } = useTranslation();
  const err = useErr(errors);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <p className="text-muted-foreground md:col-span-2">{t('setup.admin.body')}</p>
      <Field
        label={t('login.username')}
        hint={t('validation.username')}
        required
        error={err('adminUsername')}
      >
        {(p) => (
          <Input
            {...p}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={form.adminUsername}
            onChange={(e) => update({ adminUsername: e.target.value.toLowerCase() })}
          />
        )}
      </Field>
      <Field label={t('setup.admin.fullName')} required error={err('adminFullName')}>
        {(p) => (
          <Input
            {...p}
            value={form.adminFullName}
            onChange={(e) => update({ adminFullName: e.target.value })}
          />
        )}
      </Field>
      <Field
        label={t('login.password')}
        hint={t('validation.passwordHint')}
        required
        error={err('adminPassword')}
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={form.adminPassword}
            onChange={(e) => update({ adminPassword: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('account.confirmPassword')} required error={err('adminPasswordConfirm')}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={form.adminPasswordConfirm}
            onChange={(e) => update({ adminPasswordConfirm: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('setup.admin.pin')} hint={t('setup.admin.pinHint')} error={err('adminPin')}>
        {(p) => (
          <Input
            {...p}
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            value={form.adminPin}
            onChange={(e) => update({ adminPin: e.target.value.replace(/\D/g, '') })}
          />
        )}
      </Field>
      <Field label={t('setup.admin.pinConfirm')} error={err('adminPinConfirm')}>
        {(p) => (
          <Input
            {...p}
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            value={form.adminPinConfirm}
            onChange={(e) => update({ adminPinConfirm: e.target.value.replace(/\D/g, '') })}
          />
        )}
      </Field>
    </div>
  );
}

export function BackupStep({ form, errors, update }: StepProps) {
  const { t } = useTranslation();
  const err = useErr(errors);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t('setup.backup.body')}</p>
      <Alert tone="warning" title={t('setup.backup.warningTitle')}>
        {t('setup.backup.warningBody')}
      </Alert>
      <Field
        label={t('setup.backup.passphrase')}
        hint={t('setup.backup.passphraseHint')}
        required
        error={err('backupPassphrase')}
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={form.backupPassphrase}
            onChange={(e) => update({ backupPassphrase: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('setup.backup.confirm')} required error={err('backupPassphraseConfirm')}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={form.backupPassphraseConfirm}
            onChange={(e) => update({ backupPassphraseConfirm: e.target.value })}
          />
        )}
      </Field>
      <Checkbox
        label={t('setup.backup.acknowledge')}
        checked={form.backupAcknowledged}
        aria-invalid={errors.backupAcknowledged !== undefined}
        onChange={(e) => update({ backupAcknowledged: e.target.checked })}
      />
      {errors.backupAcknowledged !== undefined && (
        <p className="text-sm font-medium text-state-danger-fg">{t(errors.backupAcknowledged)}</p>
      )}
    </div>
  );
}

export function ReviewStep({
  form,
  errors,
  update,
  states,
  onEdit,
}: StepProps & { onEdit: (step: 'business' | 'liquor' | 'receipt' | 'admin') => void }) {
  const { t } = useTranslation();
  const err = useErr(errors);
  const state = states.find((s) => s.gstStateCode === form.stateCode);
  const language = LOCALE_OPTIONS.find((o) => o.code === form.locale)?.name ?? form.locale;
  const rows: {
    label: string;
    value: string;
    step: 'business' | 'liquor' | 'receipt' | 'admin';
  }[] = [
    { label: t('setup.business.orgName'), value: form.orgName, step: 'business' },
    {
      label: t('setup.business.branchName'),
      value: `${form.branchName} (${form.branchCode})`,
      step: 'business',
    },
    {
      label: t('setup.business.state'),
      value: state === undefined ? '' : stateName(t, state),
      step: 'business',
    },
    {
      label: t('setup.business.gstin'),
      value: form.gstin === '' ? t('common.none') : form.gstin,
      step: 'business',
    },
    {
      label: t('setup.liquor.title'),
      value: form.liquorEnabled
        ? t('setup.review.liquorOn', {
            vat: form.vatPercent,
            surcharge: form.surchargePercent === '' ? '0' : form.surchargePercent,
          })
        : t('setup.review.liquorOff'),
      step: 'liquor',
    },
    {
      label: t('setup.receipt.title'),
      value: `${language} · ${form.receiptLanguages.map((l) => LANGUAGE_NAMES[l]).join(' + ')}`,
      step: 'receipt',
    },
    {
      label: t('setup.admin.title'),
      value: `${form.adminFullName} (${form.adminUsername})`,
      step: 'admin',
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <dl className="divide-y rounded-xl border">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
            <dt className="w-full text-sm text-muted-foreground sm:w-48">{r.label}</dt>
            <dd className="min-w-0 flex-1 font-medium break-words">{r.value}</dd>
            <Button variant="ghost" size="sm" onClick={() => onEdit(r.step)}>
              {t('common.edit')}
            </Button>
          </div>
        ))}
      </dl>
      <Field
        label={t('setup.review.setupCode')}
        hint={t('setup.review.setupCodeHint')}
        required
        error={err('setupCode')}
      >
        {(p) => (
          <Input
            {...p}
            value={form.setupCode}
            autoComplete="one-time-code"
            spellCheck={false}
            className="font-mono text-lg tracking-widest"
            onChange={(e) => update({ setupCode: e.target.value.trim() })}
          />
        )}
      </Field>
    </div>
  );
}
