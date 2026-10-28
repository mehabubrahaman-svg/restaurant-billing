import type { AddonGroup, Category, KitchenStation, MenuItem, TaxGroup } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  ArrowLeft,
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Field,
  FoodMark,
  Input,
  Plus,
  Select,
  Spinner,
  Textarea,
  Trash,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { isApiError } from '../../api/client';
import { api, type FoodType } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { UnsavedChangesDialog } from '../../components/unsaved-changes-dialog';
import { LOCALE_OPTIONS } from '../../i18n/config';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { rupeesToPaise } from '../../lib/units';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard';
import { AdminHeader } from '../admin/admin-layout';
import { toast } from '../toast/toast-store';
import { FOOD_TYPES } from './food-type';
import {
  emptyVariant,
  formToBody,
  itemToForm,
  MAX_ADDON_GROUPS,
  MAX_VARIANTS,
  type ItemForm,
  type ItemFormErrors,
  type VariantRow,
} from './item-form';
import { localizedName } from './localized-name';
import {
  invalidateMenu,
  useAddonGroups,
  useCategories,
  useMenuItems,
  useStations,
} from './menu-queries';
import { PriceField } from './price-field';
import { byOrder } from './sort';

/** /admin/menu/items/new and /admin/menu/items/:itemId. */
export function ItemEditorPage() {
  const { t } = useTranslation();
  const { itemId } = useParams();
  const [params] = useSearchParams();
  const items = useMenuItems();
  const categories = useCategories();
  const stations = useStations();
  const groups = useAddonGroups();
  const taxGroups = useQuery({ queryKey: ['tax-groups'], queryFn: api.taxGroups.list });
  const errorMessage = useErrorMessage();

  const failed = [items, categories, stations, groups].find((q) => q.isError);
  if (failed !== undefined) {
    return (
      <Alert tone="danger" role="alert">
        {errorMessage(failed.error)}
      </Alert>
    );
  }
  if (
    items.data === undefined ||
    categories.data === undefined ||
    stations.data === undefined ||
    groups.data === undefined
  ) {
    return <Spinner label={t('common.loading')} className="py-6" />;
  }
  const item = itemId === undefined ? null : items.data.data.find((i) => i.id === itemId);
  if (item === undefined) {
    return (
      <Alert tone="warning" role="alert">
        {t('errors.notFound')}{' '}
        <Link className="underline" to="/admin/menu">
          {t('menu.backToMenu')}
        </Link>
      </Alert>
    );
  }
  return (
    <ItemEditor
      key={item?.id ?? 'new'}
      item={item}
      initialCategoryId={params.get('category') ?? ''}
      categories={categories.data.data}
      stations={stations.data.data}
      addonGroups={groups.data.data}
      taxGroups={taxGroups.data?.data ?? null}
      taxGroupsError={taxGroups.isError}
    />
  );
}

type Setter = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) => void;

function ItemEditor({
  item,
  initialCategoryId,
  categories,
  stations,
  addonGroups,
  taxGroups,
  taxGroupsError,
}: {
  item: MenuItem | null;
  initialCategoryId: string;
  categories: readonly Category[];
  stations: readonly KitchenStation[];
  addonGroups: readonly AddonGroup[];
  taxGroups: readonly TaxGroup[] | null;
  taxGroupsError: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [initial] = useState(() => itemToForm(item, initialCategoryId));
  const [form, setForm] = useState<ItemForm>(initial);
  const [errors, setErrors] = useState<ItemFormErrors | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const { blocker, release } = useUnsavedGuard(dirty);

  const set: Setter = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const result = formToBody(form);
      if (!result.ok) {
        setErrors(result.errors);
        return null;
      }
      setErrors(null);
      return item === null
        ? api.menu.createItem(result.body)
        : api.menu.updateItem(item.id, { ...result.body, version: item.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void invalidateMenu(queryClient);
      toast(t('menu.item.saved', { name: saved.name }));
      release();
      void navigate('/admin/menu');
    },
  });

  const retire = useMutation({
    mutationFn: (isActive: boolean) =>
      api.menu.updateItem(item!.id, { version: item!.version, isActive }),
    onSuccess: (saved) => {
      void invalidateMenu(queryClient);
      toast(
        saved.isActive
          ? t('menu.item.restored', { name: saved.name })
          : t('menu.item.retired', { name: saved.name }),
      );
      setConfirmRetire(false);
    },
  });

  const fieldError = (key: keyof ItemFormErrors['fields']) => {
    const k = errors?.fields[key];
    return k === undefined ? undefined : t(k);
  };
  const activeCategories = categories
    .filter((c) => c.isActive || c.id === form.categoryId)
    .sort(byOrder);
  const activeStations = stations.filter((s) => s.isActive || s.id === form.kitchenStationId);
  const shownTaxGroups = (taxGroups ?? []).filter((g) => g.isActive || g.id === form.taxGroupId);

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/admin/menu"
        className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('menu.backToMenu')}
      </Link>
      <AdminHeader
        title={item === null ? t('menu.item.add') : item.name}
        actions={
          <>
            {item !== null && (
              <Button
                variant={item.isActive ? 'outline' : 'secondary'}
                disabled={retire.isPending}
                onClick={() => (item.isActive ? setConfirmRetire(true) : retire.mutate(true))}
              >
                {item.isActive ? t('common.retire') : t('common.restore')}
              </Button>
            )}
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      />
      {item !== null && (!item.isActive || !item.isAvailable) && (
        <div className="flex flex-wrap gap-2">
          {!item.isActive && <Badge>{t('common.retired')}</Badge>}
          {item.isActive && !item.isAvailable && (
            <Badge variant="danger">{t('availability.outOfStock')}</Badge>
          )}
        </div>
      )}
      {(save.isError || retire.isError) && (
        <Alert tone="danger" role="alert">
          {errorMessage(save.error ?? retire.error)}
          {isApiError(save.error ?? retire.error, 'VERSION_CONFLICT') && ` ${t('common.reload')}`}
        </Alert>
      )}
      {errors !== null && (
        <Alert tone="danger" role="alert">
          {t('errors.validation')}
        </Alert>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={t('menu.item.sections.details')}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label={t('menu.fields.sku')}
                hint={t('menu.fields.skuHint')}
                required
                error={fieldError('sku')}
              >
                {(p) => (
                  <Input
                    {...p}
                    className="font-mono uppercase"
                    spellCheck={false}
                    autoCapitalize="characters"
                    maxLength={32}
                    value={form.sku}
                    onChange={(e) => set('sku', e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('menu.fields.category')} required error={fieldError('categoryId')}>
                {(p) => (
                  <Select
                    {...p}
                    value={form.categoryId}
                    onChange={(e) => set('categoryId', e.target.value)}
                  >
                    <option value="" disabled>
                      {t('menu.fields.categoryPlaceholder')}
                    </option>
                    {activeCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('menu.fields.nameEn')} required error={fieldError('name')}>
                {(p) => (
                  <Input {...p} value={form.name} onChange={(e) => set('name', e.target.value)} />
                )}
              </Field>
              <Field
                label={t('menu.fields.shortName')}
                hint={t('menu.fields.shortNameHint')}
                error={fieldError('shortName')}
              >
                {(p) => (
                  <Input
                    {...p}
                    maxLength={24}
                    value={form.shortName}
                    onChange={(e) => set('shortName', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <FoodTypePicker value={form.foodType} onChange={(v) => set('foodType', v)} />
            <Field
              label={t('menu.fields.description')}
              hint={t('common.optional')}
              error={fieldError('description')}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  maxLength={500}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              )}
            </Field>
          </Section>

          <Section
            title={t('menu.item.sections.translations')}
            description={t('menu.item.translationsHint')}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('menu.fields.nameHi')}>
                {(p) => (
                  <Input
                    {...p}
                    lang="hi"
                    placeholder="चिकन बिरयानी"
                    value={form.nameHi}
                    onChange={(e) => set('nameHi', e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('menu.fields.nameBn')}>
                {(p) => (
                  <Input
                    {...p}
                    lang="bn"
                    placeholder="চিকেন বিরিয়ানি"
                    value={form.nameBn}
                    onChange={(e) => set('nameBn', e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('menu.fields.descriptionHi')}>
                {(p) => (
                  <Textarea
                    {...p}
                    lang="hi"
                    rows={2}
                    value={form.descriptionHi}
                    onChange={(e) => set('descriptionHi', e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('menu.fields.descriptionBn')}>
                {(p) => (
                  <Textarea
                    {...p}
                    lang="bn"
                    rows={2}
                    value={form.descriptionBn}
                    onChange={(e) => set('descriptionBn', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Section>

          <Section title={t('menu.item.sections.price')}>
            <div className="grid gap-4 md:grid-cols-3">
              <PriceField
                label={t('menu.fields.price')}
                hint={t('menu.fields.priceHint')}
                value={form.price}
                onChange={(v) => set('price', v)}
                error={fieldError('price')}
                required
              />
              <Field
                label={t('menu.fields.taxGroup')}
                hint={taxGroupsError ? t('menu.fields.taxGroupsUnavailable') : undefined}
              >
                {(p) => (
                  <Select
                    {...p}
                    value={form.taxGroupId}
                    disabled={taxGroups === null}
                    onChange={(e) => set('taxGroupId', e.target.value)}
                  >
                    <option value="">{t('menu.fields.noTaxGroup')}</option>
                    {shownTaxGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                    {taxGroups === null && form.taxGroupId !== '' && (
                      <option value={form.taxGroupId}>{t('menu.fields.currentTaxGroup')}</option>
                    )}
                  </Select>
                )}
              </Field>
              <Field
                label={t('menu.fields.hsnSac')}
                hint={t('menu.fields.hsnSacHint')}
                error={fieldError('hsnSac')}
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    maxLength={8}
                    value={form.hsnSac}
                    onChange={(e) => set('hsnSac', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Section>

          <Section title={t('menu.item.sections.kitchen')}>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t('menu.fields.station')} hint={t('menu.fields.stationHint')}>
                {(p) => (
                  <Select
                    {...p}
                    value={form.kitchenStationId}
                    onChange={(e) => set('kitchenStationId', e.target.value)}
                  >
                    <option value="">{t('menu.fields.noStation')}</option>
                    {activeStations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={t('menu.fields.prepMinutes')}
                hint={t('menu.fields.prepHint')}
                error={fieldError('prepMinutes')}
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    value={form.prepMinutes}
                    onChange={(e) => set('prepMinutes', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={t('menu.fields.sortOrder')}
                hint={t('menu.fields.sortOrderHint')}
                error={fieldError('sortOrder')}
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    value={form.sortOrder}
                    onChange={(e) => set('sortOrder', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Section>

          <VariantsEditor
            rows={form.variants}
            errors={errors?.variants ?? {}}
            listError={fieldError('variants')}
            onChange={(rows) => set('variants', rows)}
          />

          <AddonGroupPicker
            groups={addonGroups}
            selected={form.addonGroupIds}
            error={fieldError('addonGroupIds')}
            onChange={(ids) => set('addonGroupIds', ids)}
          />
        </div>

        <ItemPreview form={form} />
      </div>

      <UnsavedChangesDialog blocker={blocker} />
      {confirmRetire && item !== null && (
        <ConfirmDialog
          title={t('menu.item.retireTitle', { name: item.name })}
          body={t('menu.item.retireBody')}
          confirmLabel={t('common.retire')}
          destructive
          busy={retire.isPending}
          error={retire.isError ? errorMessage(retire.error) : null}
          onConfirm={() => retire.mutate(false)}
          onClose={() => setConfirmRetire(false)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </Card>
  );
}

function FoodTypePicker({ value, onChange }: { value: FoodType; onChange: (v: FoodType) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t('menu.fields.foodType')}</legend>
      <div
        role="radiogroup"
        aria-label={t('menu.fields.foodType')}
        className="flex flex-wrap gap-2"
      >
        {FOOD_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={value === type}
            onClick={() => onChange(type)}
            className={cn(
              'flex min-h-touch items-center gap-2 rounded-lg border px-3 text-sm font-medium',
              value === type
                ? 'border-primary bg-accent text-accent-foreground ring-1 ring-primary'
                : 'border-input bg-surface hover:bg-muted',
            )}
          >
            {type !== 'NA' && <FoodMark type={type} label="" aria-hidden="true" size="lg" />}
            {t(`menu.foodTypes.${type}`)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function VariantsEditor({
  rows,
  errors,
  listError,
  onChange,
}: {
  rows: readonly VariantRow[];
  errors: ItemFormErrors['variants'];
  listError: string | undefined;
  onChange: (rows: VariantRow[]) => void;
}) {
  const { t } = useTranslation();
  const update = (key: string, patch: Partial<VariantRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Section title={t('menu.item.sections.variants')} description={t('menu.item.variantsHint')}>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('menu.item.noVariants')}</p>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((row, i) => {
          const e = errors[row.key];
          const name = row.name.trim() === '' ? t('menu.item.variantN', { n: i + 1 }) : row.name;
          return (
            <li
              key={row.key}
              aria-label={name}
              className="grid items-start gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_8rem_auto]"
            >
              <Field
                label={t('menu.fields.variantName')}
                error={e?.name === undefined ? undefined : t(e.name)}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={row.name}
                    placeholder={t('menu.item.variantPlaceholder')}
                    onChange={(ev) => update(row.key, { name: ev.target.value })}
                  />
                )}
              </Field>
              <Field label={t('menu.fields.nameHi')}>
                {(p) => (
                  <Input
                    {...p}
                    lang="hi"
                    value={row.hi}
                    onChange={(ev) => update(row.key, { hi: ev.target.value })}
                  />
                )}
              </Field>
              <Field label={t('menu.fields.nameBn')}>
                {(p) => (
                  <Input
                    {...p}
                    lang="bn"
                    value={row.bn}
                    onChange={(ev) => update(row.key, { bn: ev.target.value })}
                  />
                )}
              </Field>
              <PriceField
                label={t('menu.fields.variantPrice')}
                value={row.price}
                error={e?.price === undefined ? undefined : t(e.price)}
                onChange={(price) => update(row.key, { price })}
              />
              <Button
                variant="ghost"
                size="icon"
                className="self-end"
                aria-label={t('menu.item.removeVariant', { name })}
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              >
                <Trash aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
      {listError !== undefined && (
        <p className="text-sm font-medium text-state-danger-fg">{listError}</p>
      )}
      <Button
        variant="outline"
        className="self-start"
        disabled={rows.length >= MAX_VARIANTS}
        onClick={() => onChange([...rows, emptyVariant()])}
      >
        <Plus aria-hidden="true" />
        {t('menu.item.addVariant')}
      </Button>
    </Section>
  );
}

function AddonGroupPicker({
  groups,
  selected,
  error,
  onChange,
}: {
  groups: readonly AddonGroup[];
  selected: readonly string[];
  error: string | undefined;
  onChange: (ids: string[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const shown = groups.filter((g) => g.isActive || selected.includes(g.id));
  const full = selected.length >= MAX_ADDON_GROUPS;
  return (
    <Section title={t('menu.item.sections.addons')} description={t('menu.item.addonsHint')}>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('menu.item.noAddonGroups')}{' '}
          <Link className="font-medium underline" to="/admin/menu/addons">
            {t('menu.addons.add')}
          </Link>
        </p>
      ) : (
        <ul className="grid gap-x-4 md:grid-cols-2">
          {shown.map((g) => {
            const checked = selected.includes(g.id);
            return (
              <li key={g.id}>
                <Checkbox
                  label={
                    <span className="flex flex-wrap items-center gap-2">
                      {localizedName(g.name, g.nameTranslations, i18n.language)}
                      {!g.isActive && <Badge>{t('common.retired')}</Badge>}
                    </span>
                  }
                  description={`${t('menu.addons.rule', { min: g.minSelect, max: g.maxSelect })} · ${g.addons
                    .map(
                      (a) =>
                        `${localizedName(a.name, a.nameTranslations, i18n.language)} +${format.money(Money.ofPaise(a.price))}`,
                    )
                    .join(', ')}`}
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() =>
                    onChange(checked ? selected.filter((id) => id !== g.id) : [...selected, g.id])
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
      {error !== undefined && <p className="text-sm font-medium text-state-danger-fg">{error}</p>}
    </Section>
  );
}

/** How the item will read on the order pad, in the current UI language and in all three. */
function ItemPreview({ form }: { form: ItemForm }) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const translations = { hi: form.nameHi, bn: form.nameBn };
  const name = form.name.trim() === '' ? t('menu.item.previewUnnamed') : form.name.trim();
  const shown = localizedName(name, translations, i18n.language);
  const paise = rupeesToPaise(form.price);
  const variantPrices = form.variants
    .map((v) => ({ v, paise: rupeesToPaise(v.price) }))
    .filter((x) => x.v.name.trim() !== '' && x.paise !== null);

  return (
    <Card className="flex flex-col gap-4 p-4 xl:sticky xl:top-20">
      <h2 className="text-lg font-semibold">{t('menu.item.preview')}</h2>
      <div
        className="flex flex-col gap-1 rounded-xl border-2 bg-background p-3"
        aria-label={t('menu.item.previewTile')}
      >
        <div className="flex items-start gap-2">
          {form.foodType !== 'NA' && (
            <FoodMark
              type={form.foodType}
              label={t(`menu.foodTypes.${form.foodType}`)}
              className="mt-1"
            />
          )}
          <span className="text-lg leading-snug font-semibold break-words" lang={i18n.language}>
            {shown}
          </span>
        </div>
        <span className="font-semibold tabular-nums">
          {paise === null ? '—' : format.money(Money.ofPaise(paise))}
        </span>
        {variantPrices.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {variantPrices
              .map(
                ({ v, paise: p }) =>
                  `${localizedName(v.name, { hi: v.hi, bn: v.bn }, i18n.language)} ${format.money(Money.ofPaise(p ?? 0))}`,
              )
              .join(' · ')}
          </span>
        )}
      </div>
      <dl className="flex flex-col gap-2 text-sm">
        {LOCALE_OPTIONS.map((locale) => {
          const own = localizedName(name, translations, locale.code);
          const missing = locale.code !== 'en-IN' && own === name;
          return (
            <div key={locale.code} className="flex flex-col">
              <dt className="text-muted-foreground" lang={locale.code}>
                {locale.name}
              </dt>
              <dd
                lang={missing ? 'en-IN' : locale.code}
                className={cn('font-medium break-words', missing && 'text-muted-foreground')}
              >
                {missing ? t('menu.item.usesEnglish', { name }) : own}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
