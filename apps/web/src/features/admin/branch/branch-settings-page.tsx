import {
  UpdateBranchSettingsRequestSchema,
  type BranchSettings,
  type UpdateBranchSettingsRequest,
} from '@restroos/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  SegmentedControl,
  Select,
  Textarea,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../../api/client';
import { api } from '../../../api/endpoints';
import { LOCALE_OPTIONS } from '../../../i18n/config';
import { tDynamic } from '../../../lib/dynamic-t';
import { useErrorMessage } from '../../../lib/errors';
import { fieldErrors } from '../../../lib/form';
import { usePermission } from '../../auth/permissions';
import { gstinProblem } from '../../setup/gstin';
import { RECEIPT_LANGUAGES, type ReceiptLanguage } from '../../setup/setup-form';
import { toast } from '../../toast/toast-store';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

const LANGUAGE_NAMES: Record<ReceiptLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
  bn: 'বাংলা',
};
const ROUNDING = [1, 50, 100] as const;

const MESSAGES = {
  name: 'validation.nameLength',
  phone: 'validation.phone',
  gstin: 'setup.errors.gstinFormat',
  vatTin: 'setup.errors.vatTin',
  exciseLicenceNo: 'setup.errors.excise',
  receiptLanguages: 'setup.errors.receiptLanguages',
  dayStartsAt: 'branch.dayStartError',
  receiptHeader: 'branch.receiptTextError',
  receiptFooter: 'branch.receiptTextError',
} as const;
type ErrorKey =
  | (typeof MESSAGES)[keyof typeof MESSAGES]
  | 'setup.errors.gstinState'
  | 'setup.errors.gstinChecksum';

export function BranchSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: ['branch-settings'], queryFn: api.settings.branch });
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title={t('branch.title')} description={t('branch.description')} />
      <QueryState query={settings}>
        {(data) => <BranchForm key={data.version} settings={data} />}
      </QueryState>
    </div>
  );
}

type Draft = Omit<
  BranchSettings,
  'id' | 'code' | 'stateCode' | 'stateName' | 'version' | 'liquorEnabled'
> & {
  address: string;
  phone: string;
  gstin: string;
  vatTin: string;
  exciseLicenceNo: string;
};

function BranchForm({ settings }: { settings: BranchSettings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canEdit = usePermission('settings.manage');
  const [draft, setDraft] = useState<Draft>({
    name: settings.name,
    address: settings.address ?? '',
    phone: settings.phone ?? '',
    gstin: settings.gstin ?? '',
    vatTin: settings.vatTin ?? '',
    exciseLicenceNo: settings.exciseLicenceNo ?? '',
    liquorInvoice: settings.liquorInvoice,
    cashRounding: settings.cashRounding,
    defaultLocale: settings.defaultLocale,
    receiptLanguages: settings.receiptLanguages,
    receiptHeader: settings.receiptHeader,
    receiptFooter: settings.receiptFooter,
    dayStartsAt: settings.dayStartsAt,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof MESSAGES, ErrorKey>>>({});
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const orNull = (s: string) => (s.trim() === '' ? null : s.trim());

  const save = useMutation({
    mutationFn: async () => {
      const body: UpdateBranchSettingsRequest = {
        version: settings.version,
        name: draft.name,
        address: orNull(draft.address),
        phone: orNull(draft.phone),
        gstin: orNull(draft.gstin),
        vatTin: orNull(draft.vatTin),
        exciseLicenceNo: orNull(draft.exciseLicenceNo),
        ...(settings.liquorEnabled ? { liquorInvoice: draft.liquorInvoice } : {}),
        cashRounding: draft.cashRounding as 1 | 50 | 100,
        defaultLocale: draft.defaultLocale,
        receiptLanguages: draft.receiptLanguages,
        receiptHeader: draft.receiptHeader,
        receiptFooter: draft.receiptFooter,
        dayStartsAt: draft.dayStartsAt,
      };
      const parsed = UpdateBranchSettingsRequestSchema.safeParse(body);
      const found: Partial<Record<keyof typeof MESSAGES, ErrorKey>> = fieldErrors(parsed, MESSAGES);
      const gstinIssue =
        draft.gstin.trim() === '' ? null : gstinProblem(draft.gstin, settings.stateCode);
      if (gstinIssue === 'state') found.gstin = 'setup.errors.gstinState';
      if (gstinIssue === 'checksum') found.gstin = 'setup.errors.gstinChecksum';
      if (gstinIssue === 'format') found.gstin = 'setup.errors.gstinFormat';
      setErrors(found);
      if (!parsed.success || Object.keys(found).length > 0) return null;
      return api.settings.updateBranch(parsed.data);
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      queryClient.setQueryData(['branch-settings'], saved);
      toast(t('branch.saved'));
    },
  });

  const err = (f: keyof typeof MESSAGES) => (errors[f] === undefined ? undefined : t(errors[f]));
  const disabled = !canEdit;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      noValidate
    >
      {save.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(save.error)}
          {isApiError(save.error, 'VERSION_CONFLICT') && (
            <Button
              variant="outline"
              size="sm"
              className="ms-2"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['branch-settings'] })}
            >
              {t('common.reload')}
            </Button>
          )}
        </Alert>
      )}
      <fieldset disabled={disabled} className="contents">
        <Card>
          <CardHeader>
            <CardTitle>{t('branch.business')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label={t('setup.business.branchName')} required error={err('name')}>
              {(p) => (
                <Input {...p} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              )}
            </Field>
            <Field label={t('setup.business.state')} hint={t('branch.stateFixed')}>
              {(p) => (
                <Input
                  {...p}
                  disabled
                  value={`${tDynamic(t, `states.${settings.stateCode}`, settings.stateName)} (${settings.stateCode}) · ${settings.code}`}
                />
              )}
            </Field>
            <Field label={t('setup.business.address')} className="md:col-span-2">
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  value={draft.address}
                  onChange={(e) => set({ address: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('setup.business.phone')} error={err('phone')}>
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                />
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('branch.registrations')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label={t('setup.business.gstin')} error={err('gstin')}>
              {(p) => (
                <Input
                  {...p}
                  className="font-mono"
                  maxLength={15}
                  value={draft.gstin}
                  onChange={(e) => set({ gstin: e.target.value.toUpperCase() })}
                />
              )}
            </Field>
            <Field label={t('setup.liquor.vatTin')} error={err('vatTin')}>
              {(p) => (
                <Input
                  {...p}
                  value={draft.vatTin}
                  onChange={(e) => set({ vatTin: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('setup.liquor.excise')} error={err('exciseLicenceNo')}>
              {(p) => (
                <Input
                  {...p}
                  value={draft.exciseLicenceNo}
                  onChange={(e) => set({ exciseLicenceNo: e.target.value })}
                />
              )}
            </Field>
            {settings.liquorEnabled && (
              <div className="flex flex-col gap-1.5 md:col-span-3">
                <span className="text-sm font-medium">{t('branch.liquorBill')}</span>
                <SegmentedControl<'SAME' | 'SEPARATE'>
                  aria-label={t('branch.liquorBill')}
                  value={draft.liquorInvoice}
                  onValueChange={(v) => set({ liquorInvoice: v })}
                  options={[
                    { value: 'SAME', label: t('branch.liquorSame') },
                    { value: 'SEPARATE', label: t('branch.liquorSeparate') },
                  ]}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('branch.billing')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label={t('branch.rounding')} hint={t('branch.roundingHint')}>
              {(p) => (
                <Select
                  {...p}
                  value={String(draft.cashRounding)}
                  onChange={(e) => set({ cashRounding: Number(e.target.value) })}
                >
                  {ROUNDING.map((r) => (
                    <option key={r} value={r}>
                      {r === 1
                        ? t('branch.roundingNone')
                        : r === 50
                          ? t('branch.roundingHalf')
                          : t('branch.roundingRupee')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={t('branch.dayStart')}
              hint={t('branch.dayStartHint')}
              error={err('dayStartsAt')}
            >
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  value={draft.dayStartsAt}
                  onChange={(e) => set({ dayStartsAt: e.target.value })}
                />
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('branch.languagesAndReceipt')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label={t('branch.defaultLanguage')} hint={t('branch.defaultLanguageHint')}>
              {(p) => (
                <Select
                  {...p}
                  value={draft.defaultLocale}
                  onChange={(e) => set({ defaultLocale: e.target.value as Draft['defaultLocale'] })}
                >
                  {LOCALE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code} lang={o.code}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <fieldset className="flex flex-col">
              <legend className="text-sm font-medium">{t('setup.receipt.title')}</legend>
              {RECEIPT_LANGUAGES.map((lang) => {
                const checked = draft.receiptLanguages.includes(lang);
                return (
                  <Checkbox
                    key={lang}
                    label={<span lang={lang}>{LANGUAGE_NAMES[lang]}</span>}
                    checked={checked}
                    disabled={disabled || (!checked && draft.receiptLanguages.length >= 2)}
                    onChange={(e) =>
                      set({
                        receiptLanguages: e.target.checked
                          ? [...draft.receiptLanguages, lang]
                          : draft.receiptLanguages.filter((l) => l !== lang),
                      })
                    }
                  />
                );
              })}
              {errors.receiptLanguages !== undefined && (
                <p className="text-sm font-medium text-state-danger-fg">
                  {t(errors.receiptLanguages)}
                </p>
              )}
            </fieldset>
            <Field
              label={t('branch.receiptHeader')}
              hint={t('branch.receiptHeaderHint')}
              error={err('receiptHeader')}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  maxLength={500}
                  value={draft.receiptHeader}
                  onChange={(e) => set({ receiptHeader: e.target.value })}
                />
              )}
            </Field>
            <Field
              label={t('branch.receiptFooter')}
              hint={t('branch.receiptFooterHint')}
              error={err('receiptFooter')}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  maxLength={500}
                  value={draft.receiptFooter}
                  onChange={(e) => set({ receiptFooter: e.target.value })}
                />
              )}
            </Field>
          </CardContent>
        </Card>
      </fieldset>
      {canEdit && (
        <Button type="submit" className="self-start" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      )}
    </form>
  );
}
