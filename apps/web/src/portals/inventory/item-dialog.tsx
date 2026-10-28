import type { BaseUnit, InventoryItem, Unit } from '@restroos/contracts';
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  SegmentedControl,
  Select,
  Switch,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { usePermission } from '../../features/auth/permissions';
import { invalidateStock, useUnits } from '../../features/inventory/inventory-queries';
import { knownUnits, MILLI_PER_BASE, unitsFor } from '../../features/inventory/quantity';
import { QuantityField, useItemName } from '../../features/inventory/stock-controls';
import { useStockFormat } from '../../features/inventory/use-stock-format';
import { toast } from '../../features/toast/toast-store';
import { useErrorMessage } from '../../lib/errors';
import { MANAGE_PERMISSION } from './inventory-layout';
import {
  draftToBody,
  itemToDraft,
  withBaseUnit,
  type ItemDraft,
  type ItemDraftField,
} from './item-form';

const BASE_UNITS: readonly BaseUnit[] = ['g', 'ml', 'pc'];

/** Add or edit a stock item: names, category, units, shelf life and this branch's levels. */
export function ItemDialog({
  item,
  categories,
  onClose,
}: {
  item: InventoryItem | null;
  /** Categories already in use, offered as suggestions. */
  categories: readonly string[];
  onClose: () => void;
}) {
  const units = useUnits();
  const { t } = useTranslation();
  if (units.data === undefined && !units.isError) return null;
  return (
    <ItemForm
      item={item}
      categories={categories}
      // Without the unit list (an error), items can still be kept in their base units.
      units={knownUnits(units.data?.data ?? [])}
      unitsUnavailable={units.isError ? t('inventory.item.unitsUnavailable') : null}
      onClose={onClose}
    />
  );
}

function ItemForm({
  item,
  categories,
  units,
  unitsUnavailable,
  onClose,
}: {
  item: InventoryItem | null;
  categories: readonly string[];
  units: readonly Unit[];
  unitsUnavailable: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const itemName = useItemName();
  const listId = useId();
  const canManage = usePermission(MANAGE_PERMISSION);
  const [draft, setDraft] = useState<ItemDraft>(() => itemToDraft(item, units));
  const [errors, setErrors] = useState<Partial<Record<ItemDraftField | 'form', string>>>({});
  // The base unit is fixed once stock has moved.
  const moved = useQuery({
    queryKey: ['inventory', 'has-movements', item?.id],
    queryFn: () => api.inventory.movements({ inventoryItemId: item!.id, limit: 1 }),
    enabled: item !== null,
  });
  const baseLocked = item !== null && (moved.data === undefined || moved.data.data.length > 0);

  const save = useMutation({
    mutationFn: async (change: 'save' | 'retire' | 'restore') => {
      if (item !== null && change !== 'save') {
        return api.inventory.updateItem(item.id, {
          version: item.version,
          isActive: change === 'restore',
        });
      }
      const result = draftToBody(draft, units);
      if (!result.ok) {
        setErrors(Object.fromEntries(Object.entries(result.errors).map(([k, v]) => [k, t(v)])));
        return null;
      }
      setErrors({});
      return item === null
        ? api.inventory.createItem(result.body)
        : api.inventory.updateItem(item.id, { ...result.body, version: item.version });
    },
    onSuccess: (saved, change) => {
      if (saved === null) return;
      void invalidateStock(queryClient);
      const name = itemName(saved);
      toast(
        change === 'retire'
          ? t('inventory.item.retired', { name })
          : change === 'restore'
            ? t('inventory.item.restored', { name })
            : t('inventory.item.saved', { name }),
      );
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, 'SKU_TAKEN')) setErrors({ sku: errorMessage(error) });
    },
  });

  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const choices = unitsFor(draft.baseUnit, units);
  // The base unit itself is the '' choice, unless an item was saved with it explicitly.
  const purchaseChoices = choices.filter(
    (u) => u.toBaseMilli !== MILLI_PER_BASE || u.id === draft.purchaseUnitId,
  );
  const busy = save.isPending;
  const showError = save.isError && !isApiError(save.error, 'SKU_TAKEN');

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      dismissible={!busy}
      closeLabel={t('common.close')}
      title={
        item === null
          ? t('inventory.item.add')
          : t('inventory.item.editNamed', { name: itemName(item) })
      }
      footer={
        <>
          {item !== null && canManage && (
            <Button
              variant={item.isActive ? 'destructive' : 'secondary'}
              className="me-auto"
              disabled={busy}
              onClick={() => save.mutate(item.isActive ? 'retire' : 'restore')}
            >
              {item.isActive ? t('common.retire') : t('common.restore')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate('save')} disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {unitsUnavailable !== null && <Alert tone="warning">{unitsUnavailable}</Alert>}
        {showError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
            {isApiError(save.error, 'VERSION_CONFLICT') && ` ${t('common.reload')}`}
          </Alert>
        )}
        {errors.form !== undefined && (
          <Alert tone="danger" role="alert">
            {errors.form}
          </Alert>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t('menu.fields.sku')}
            hint={t('inventory.item.skuHint')}
            required
            error={errors.sku}
          >
            {(p) => (
              <Input
                {...p}
                className="font-mono uppercase"
                spellCheck={false}
                autoCapitalize="characters"
                maxLength={32}
                value={draft.sku}
                onChange={(e) => set('sku', e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('inventory.fields.category')}
            hint={t('inventory.item.categoryHint')}
            error={errors.category}
          >
            {(p) => (
              <>
                <Input
                  {...p}
                  list={listId}
                  maxLength={60}
                  value={draft.category}
                  onChange={(e) => set('category', e.target.value)}
                />
                <datalist id={listId}>
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('menu.fields.nameEn')} required error={errors.name}>
            {(p) => (
              <Input
                {...p}
                maxLength={120}
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('menu.fields.nameHi')}>
            {(p) => (
              <Input
                {...p}
                lang="hi"
                placeholder="बासमती चावल"
                value={draft.nameHi}
                onChange={(e) => set('nameHi', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('menu.fields.nameBn')}>
            {(p) => (
              <Input
                {...p}
                lang="bn"
                placeholder="বাসমতি চাল"
                value={draft.nameBn}
                onChange={(e) => set('nameBn', e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">{t('inventory.fields.baseUnit')}</legend>
            <SegmentedControl<BaseUnit>
              className="self-start"
              aria-label={t('inventory.fields.baseUnit')}
              value={draft.baseUnit}
              onValueChange={(v) => {
                if (!baseLocked) setDraft((d) => withBaseUnit(d, v, units));
              }}
              options={BASE_UNITS.map((u) => ({ value: u, label: t(`inventory.baseUnits.${u}`) }))}
            />
            <p className="text-sm text-muted-foreground">
              {baseLocked ? t('inventory.item.baseLocked') : t('inventory.item.baseHint')}
            </p>
          </fieldset>
          <Field label={t('inventory.fields.purchaseUnit')} hint={t('inventory.item.purchaseHint')}>
            {(p) => (
              <Select
                {...p}
                value={draft.purchaseUnitId}
                onChange={(e) => set('purchaseUnitId', e.target.value)}
              >
                <option value="">{t('inventory.item.sameAsBase')}</option>
                {purchaseChoices.map((u) => (
                  <option key={u.id} value={u.id}>
                    {format.unitLabel(u.code)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid items-start gap-4 md:grid-cols-2">
          <Switch
            checked={draft.isPerishable}
            onCheckedChange={(v) => set('isPerishable', v)}
            label={t('inventory.fields.perishable')}
            description={t('inventory.item.perishableHint')}
          />
          {draft.isPerishable && (
            <Field
              label={t('inventory.fields.shelfLife')}
              hint={t('inventory.item.shelfLifeHint')}
              error={errors.shelfLife}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={draft.shelfLifeDays}
                  onChange={(e) => set('shelfLifeDays', e.target.value)}
                />
              )}
            </Field>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <QuantityField
            label={t('inventory.fields.reorderLevel')}
            hint={t('inventory.item.reorderHint')}
            error={errors.reorder}
            value={draft.reorder}
            units={choices}
            onChange={(v) => set('reorder', v)}
          />
          <QuantityField
            label={t('inventory.fields.maxLevel')}
            hint={t('inventory.item.maxHint')}
            error={errors.max}
            value={draft.max}
            units={choices}
            onChange={(v) => set('max', v)}
          />
        </div>
      </div>
    </Dialog>
  );
}
