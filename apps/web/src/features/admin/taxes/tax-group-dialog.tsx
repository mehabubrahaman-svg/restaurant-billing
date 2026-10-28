import type { TaxGroup } from '@restroos/contracts';
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  Plus,
  SegmentedControl,
  Select,
  Switch,
  Trash,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../../api/client';
import { api, type SaveTaxGroupBody, type TaxComponentBody } from '../../../api/endpoints';
import { useErrorMessage } from '../../../lib/errors';
import { bpToPercent, percentToBp } from '../../../lib/units';
import { toast } from '../../toast/toast-store';
import { gstComponents, simpleGstRate, simpleVat, vatComponents } from './tax-components';

type TaxType = 'GST' | 'VAT' | 'NONE';
type Category = 'TAXABLE' | 'NIL_RATED' | 'EXEMPT' | 'NON_GST';
const CATEGORIES: readonly Category[] = ['TAXABLE', 'NIL_RATED', 'EXEMPT', 'NON_GST'];
const CODES: readonly TaxComponentBody['code'][] = [
  'CGST',
  'SGST',
  'IGST',
  'VAT',
  'SURCHARGE',
  'CESS',
];
const SCOPES: readonly TaxComponentBody['appliesTo'][] = ['ALWAYS', 'INTRA_STATE', 'INTER_STATE'];

interface Row {
  code: TaxComponentBody['code'];
  rate: string;
  appliesTo: TaxComponentBody['appliesTo'];
}

type ErrorKey =
  | 'validation.nameLength'
  | 'validation.percent'
  | 'taxes.errors.gstOdd'
  | 'taxes.errors.components';

/** Create or edit a tax group. GST from one rate; VAT + surcharge; or an advanced component list. */
export function TaxGroupDialog({
  group,
  onClose,
}: {
  group: TaxGroup | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();

  const gstRate = group === null ? null : simpleGstRate(group.components);
  const vat = group === null ? null : simpleVat(group.components);
  const [name, setName] = useState(group?.name ?? '');
  const [taxType, setTaxType] = useState<TaxType>(group?.taxType ?? 'GST');
  const [category, setCategory] = useState<Category>(group?.taxCategory ?? 'TAXABLE');
  const [inclusive, setInclusive] = useState(group?.isInclusive ?? false);
  const [series, setSeries] = useState<'INV' | 'LIQ'>(
    group?.invoiceSeries === 'LIQ' ? 'LIQ' : group === null ? 'INV' : 'INV',
  );
  const [advanced, setAdvanced] = useState(
    group !== null && group.taxType === 'GST' && gstRate === null,
  );
  const [rate, setRate] = useState(gstRate === null ? '' : bpToPercent(gstRate));
  const [vatRate, setVatRate] = useState(vat === null ? '' : bpToPercent(vat.vatBp));
  const [surcharge, setSurcharge] = useState(
    vat === null || vat.surchargeBp === 0 ? '' : bpToPercent(vat.surchargeBp),
  );
  const [rows, setRows] = useState<Row[]>(
    (group?.components ?? []).map((c) => ({
      code: c.code,
      rate: bpToPercent(c.rateBp),
      appliesTo: c.appliesTo,
    })),
  );
  const [errors, setErrors] = useState<
    Partial<Record<'name' | 'rate' | 'vat' | 'surcharge' | 'rows', ErrorKey>>
  >({});

  function components(): TaxComponentBody[] | ErrorKey {
    if (taxType === 'NONE') return [];
    if (taxType === 'GST' && !advanced) {
      const bp = percentToBp(rate);
      if (bp === null) return 'validation.percent';
      return gstComponents(bp) ?? 'taxes.errors.gstOdd';
    }
    if (taxType === 'VAT' && !advanced) {
      const v = percentToBp(vatRate);
      const s = surcharge.trim() === '' ? 0 : percentToBp(surcharge);
      if (v === null || s === null) return 'validation.percent';
      return vatComponents(v, s);
    }
    const out: TaxComponentBody[] = [];
    for (const r of rows) {
      const bp = percentToBp(r.rate);
      if (bp === null || bp > 100_00) return 'taxes.errors.components';
      out.push({ code: r.code, rateBp: bp, appliesTo: r.appliesTo });
    }
    return out.length === 0 || out.length > 6 ? 'taxes.errors.components' : out;
  }

  const save = useMutation({
    mutationFn: async () => {
      const found: typeof errors = {};
      if (name.trim().length < 2 || name.trim().length > 60) found.name = 'validation.nameLength';
      const comps = components();
      if (typeof comps === 'string') {
        if (taxType === 'GST' && !advanced) found.rate = comps;
        else if (taxType === 'VAT' && !advanced) found.vat = comps;
        else found.rows = comps;
      }
      setErrors(found);
      if (Object.keys(found).length > 0 || typeof comps === 'string') return null;
      const body: SaveTaxGroupBody = {
        name: name.trim(),
        taxType,
        taxCategory: category,
        invoiceSeries: series,
        isInclusive: inclusive,
        components: comps,
      };
      return group === null
        ? api.taxGroups.create(body)
        : api.taxGroups.update(group.id, { ...body, version: group.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: ['tax-groups'] });
      toast(t('taxes.saved', { name: saved.name }));
      onClose();
    },
  });

  function switchToAdvanced() {
    const comps = components();
    if (typeof comps !== 'string') {
      setRows(
        comps.map((c) => ({ code: c.code, rate: bpToPercent(c.rateBp), appliesTo: c.appliesTo })),
      );
    }
    setAdvanced(true);
  }

  const err = (k: keyof typeof errors) => (errors[k] === undefined ? undefined : t(errors[k]));
  const preview = taxType === 'GST' && !advanced ? gstComponents(percentToBp(rate) ?? -1) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={group === null ? t('taxes.add') : t('taxes.editTitle', { name: group.name })}
      size="lg"
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
      <div className="flex flex-col gap-5">
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
            {isApiError(save.error, 'VERSION_CONFLICT') && ` ${t('common.reload')}`}
          </Alert>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('taxes.name')} hint={t('taxes.nameHint')} required error={err('name')}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('taxes.type')}</span>
            <SegmentedControl<TaxType>
              aria-label={t('taxes.type')}
              value={taxType}
              onValueChange={(v) => {
                setTaxType(v);
                setAdvanced(false);
                if (group === null) setSeries(v === 'VAT' ? 'LIQ' : 'INV');
              }}
              options={[
                { value: 'GST', label: t('taxes.types.GST') },
                { value: 'VAT', label: t('taxes.types.VAT') },
                { value: 'NONE', label: t('taxes.types.NONE') },
              ]}
            />
          </div>
          <Field label={t('taxes.category')}>
            {(p) => (
              <Select
                {...p}
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`taxes.categories.${c}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('taxes.series')} hint={t('taxes.seriesHint')}>
            {(p) => (
              <Select
                {...p}
                value={series}
                onChange={(e) => setSeries(e.target.value as 'INV' | 'LIQ')}
              >
                <option value="INV">{t('taxes.seriesInv')}</option>
                <option value="LIQ">{t('taxes.seriesLiq')}</option>
              </Select>
            )}
          </Field>
          <Switch
            className="md:col-span-2"
            label={t('taxes.inclusive')}
            description={t('taxes.inclusiveHint')}
            checked={inclusive}
            onCheckedChange={setInclusive}
          />
        </div>

        {taxType === 'GST' && !advanced && (
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <Field
              label={t('taxes.gstRate')}
              hint={t('taxes.gstRateHint')}
              required
              error={err('rate')}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  className="max-w-40"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              )}
            </Field>
            {preview !== null && (
              <p className="text-sm text-muted-foreground">
                {t('taxes.gstPreview', {
                  half: bpToPercent(preview[0]!.rateBp),
                  full: bpToPercent(preview[2]!.rateBp),
                })}
              </p>
            )}
            <Button variant="ghost" size="sm" className="self-start" onClick={switchToAdvanced}>
              {t('taxes.advanced')}
            </Button>
          </div>
        )}

        {taxType === 'VAT' && !advanced && (
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <Alert tone="info">{t('setup.liquor.advisor')}</Alert>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('setup.liquor.vatPercent')} required error={err('vat')}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={vatRate}
                    onChange={(e) => setVatRate(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('setup.liquor.surchargePercent')} hint={t('common.optional')}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={surcharge}
                    onChange={(e) => setSurcharge(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Button variant="ghost" size="sm" className="self-start" onClick={switchToAdvanced}>
              {t('taxes.advanced')}
            </Button>
          </div>
        )}

        {taxType !== 'NONE' && advanced && (
          <fieldset className="flex flex-col gap-3 rounded-xl border p-4">
            <legend className="px-1 text-sm font-medium">{t('taxes.components')}</legend>
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_1fr_auto] items-end gap-2">
                <Field label={t('taxes.componentCode')}>
                  {(p) => (
                    <Select
                      {...p}
                      value={row.code}
                      onChange={(e) =>
                        setRows(
                          rows.map((r, j) =>
                            j === i ? { ...r, code: e.target.value as Row['code'] } : r,
                          ),
                        )
                      }
                    >
                      {CODES.map((c) => (
                        <option key={c} value={c}>
                          {c === 'SURCHARGE' ? t('taxes.surcharge') : c}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('taxes.ratePercent')}>
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="decimal"
                      value={row.rate}
                      onChange={(e) =>
                        setRows(rows.map((r, j) => (j === i ? { ...r, rate: e.target.value } : r)))
                      }
                    />
                  )}
                </Field>
                <Field label={t('taxes.appliesTo')}>
                  {(p) => (
                    <Select
                      {...p}
                      value={row.appliesTo}
                      onChange={(e) =>
                        setRows(
                          rows.map((r, j) =>
                            j === i ? { ...r, appliesTo: e.target.value as Row['appliesTo'] } : r,
                          ),
                        )
                      }
                    >
                      {SCOPES.map((s) => (
                        <option key={s} value={s}>
                          {t(`taxes.scopes.${s}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('taxes.removeComponent')}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <Trash aria-hidden="true" />
                </Button>
              </div>
            ))}
            {errors.rows !== undefined && (
              <p className="text-sm font-medium text-state-danger-fg">{t(errors.rows)}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={rows.length >= 6}
              onClick={() => setRows([...rows, { code: 'CESS', rate: '', appliesTo: 'ALWAYS' }])}
            >
              <Plus aria-hidden="true" />
              {t('taxes.addComponent')}
            </Button>
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
