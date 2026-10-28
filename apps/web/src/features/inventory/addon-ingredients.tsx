import type { AddonIngredients, InventoryItem, Unit } from '@restroos/contracts';
import { Alert, Button, Dialog, Field, Package, Plus, Spinner, Trash } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { usePermission } from '../auth/permissions';
import { toast } from '../toast/toast-store';
import {
  INVENTORY_KEYS,
  itemsById,
  useAddonIngredients,
  useInventoryItems,
  useUnits,
} from './inventory-queries';
import { knownUnits, parseQuantity, unitsFor } from './quantity';
import { RECIPE_EDIT_PERMISSION, RECIPE_VIEW_PERMISSIONS } from './recipe-section';
import { emptyRow, recipeToDraft, rowFor, type IngredientRow } from './recipe-form';
import { ItemSelect, QuantityField, useItemName } from './stock-controls';
import { useStockFormat } from './use-stock-format';

/** The Hub takes at most this many ingredients per add-on. */
const MAX_ADDON_INGREDIENTS = 20;
type Problem = 'item' | 'qty' | 'twice';
const PROBLEM_KEYS = {
  item: 'inventory.errors.item',
  qty: 'inventory.errors.quantity',
  twice: 'inventory.errors.twice',
} as const;

/** "Stock" next to an add-on: what one of it takes from the store room (extra cheese = 30 g). */
export function AddonIngredientsButton({ addon }: { addon: { id: string; name: string } }) {
  const { t } = useTranslation();
  const canView = usePermission(RECIPE_VIEW_PERMISSIONS);
  const [open, setOpen] = useState(false);
  if (!canView) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('inventory.addon.open', { name: addon.name })}
        onClick={() => setOpen(true)}
      >
        <Package aria-hidden="true" />
        {t('inventory.addon.button')}
      </Button>
      {open && <AddonIngredientsDialog addon={addon} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The saved ingredients as editor rows, in each item's base unit. */
function rowsOf(current: AddonIngredients, units: readonly Unit[]): IngredientRow[] {
  const draft = recipeToDraft(
    {
      yieldPortions: 1,
      ingredients: current.ingredients.map((i) => ({ ...i, wastageBp: 0, costPerPortion: 0 })),
    },
    units,
  );
  return draft.rows.length === 0 ? [emptyRow()] : [...draft.rows];
}

/** Checks the rows: the full list to send, or what is wrong with which row. Blank rows are skipped. */
function rowsToLines(
  rows: readonly IngredientRow[],
  units: readonly Unit[],
):
  | { ok: true; lines: { inventoryItemId: string; qtyMilli: number }[] }
  | { ok: false; problems: Record<string, Problem> } {
  const problems: Record<string, Problem> = {};
  const seen = new Set<string>();
  const lines: { inventoryItemId: string; qtyMilli: number }[] = [];
  for (const row of rows) {
    if (row.itemId === '' && row.qty.text.trim() === '') continue;
    const unit = units.find((u) => u.id === row.qty.unitId);
    const qty = unit === undefined ? null : parseQuantity(row.qty.text, unit.toBaseMilli);
    if (row.itemId === '') problems[row.key] = 'item';
    else if (seen.has(row.itemId)) problems[row.key] = 'twice';
    else if (qty === null || qty <= 0) problems[row.key] = 'qty';
    else lines.push({ inventoryItemId: row.itemId, qtyMilli: qty });
    seen.add(row.itemId);
  }
  return Object.keys(problems).length > 0 ? { ok: false, problems } : { ok: true, lines };
}

function AddonIngredientsDialog({
  addon,
  onClose,
}: {
  addon: { id: string; name: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canEdit = usePermission(RECIPE_EDIT_PERMISSION);
  const current = useAddonIngredients(addon.id);
  const items = useInventoryItems(false);
  const unitList = useUnits();
  const units = knownUnits(unitList.data?.data ?? []);
  const failed = [current, items].find((q) => q.isError);
  const [rows, setRows] = useState<IngredientRow[] | null>(null);
  const [problems, setProblems] = useState<Record<string, Problem>>({});
  // The rows start from what is saved, once it (and the units) have arrived.
  if (rows === null && current.data !== undefined && !unitList.isPending) {
    setRows(rowsOf(current.data, units));
  }

  const save = useMutation({
    mutationFn: async () => {
      const result = rowsToLines(rows ?? [], units);
      setProblems(result.ok ? {} : result.problems);
      return result.ok ? api.inventory.setAddonIngredients(addon.id, result.lines) : null;
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      queryClient.setQueryData(INVENTORY_KEYS.addonIngredients(addon.id), saved);
      toast(t('inventory.addon.saved', { name: addon.name }));
      onClose();
    },
  });

  const ready = failed === undefined && rows !== null && items.data !== undefined;
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={t('inventory.addon.title', { name: addon.name })}
      description={t('inventory.addon.description')}
      footer={
        ready && canEdit ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={save.isPending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        )
      }
    >
      {failed !== undefined ? (
        <Alert tone="danger" role="alert">
          {errorMessage(failed.error)}
        </Alert>
      ) : rows === null || items.data === undefined || current.data === undefined ? (
        <Spinner label={t('common.loading')} />
      ) : canEdit ? (
        <div className="flex flex-col gap-3">
          {save.isError && (
            <Alert tone="danger" role="alert">
              {errorMessage(save.error)}
            </Alert>
          )}
          <EditRows
            rows={rows}
            items={items.data.data}
            units={units}
            problems={problems}
            onChange={setRows}
          />
        </div>
      ) : (
        <SavedIngredients current={current.data} items={items.data.data} />
      )}
    </Dialog>
  );
}

function SavedIngredients({
  current,
  items,
}: {
  current: AddonIngredients;
  items: readonly InventoryItem[];
}) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const name = useItemName();
  const byId = itemsById(items);
  if (current.ingredients.length === 0) {
    return <p className="text-muted-foreground">{t('inventory.addon.none')}</p>;
  }
  return (
    <ul className="flex flex-col divide-y">
      {current.ingredients.map((i) => {
        const item = byId.get(i.inventoryItemId);
        return (
          <li key={i.inventoryItemId} className="flex justify-between gap-3 py-2">
            <span>{item === undefined ? i.name : name(item)}</span>
            <span className="tabular-nums">{format.qty(i.qtyMilli, i.baseUnit)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function EditRows({
  rows,
  items,
  units,
  problems,
  onChange,
}: {
  rows: readonly IngredientRow[];
  items: readonly InventoryItem[];
  units: readonly Unit[];
  problems: Readonly<Record<string, Problem>>;
  onChange: (rows: IngredientRow[]) => void;
}) {
  const { t } = useTranslation();
  const name = useItemName();
  const byId = itemsById(items);
  const update = (key: string, patch: Partial<IngredientRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <>
      <ol className="flex flex-col gap-3">
        {rows.map((row, i) => {
          const item = byId.get(row.itemId);
          const problem = problems[row.key];
          const label =
            item === undefined ? t('inventory.recipe.ingredientN', { n: i + 1 }) : name(item);
          return (
            <li
              key={row.key}
              aria-label={label}
              className="grid items-start gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
            >
              <Field
                label={t('inventory.recipe.ingredient')}
                error={
                  problem === 'item' || problem === 'twice' ? t(PROBLEM_KEYS[problem]) : undefined
                }
              >
                {(p) => (
                  <ItemSelect
                    control={p}
                    items={items}
                    value={row.itemId}
                    onChange={(id) => {
                      const next = byId.get(id);
                      if (next !== undefined) update(row.key, rowFor(next, units, row));
                    }}
                  />
                )}
              </Field>
              <QuantityField
                label={t('inventory.addon.quantity')}
                error={problem === 'qty' ? t(PROBLEM_KEYS.qty) : undefined}
                value={row.qty}
                units={item === undefined ? [] : unitsFor(item.baseUnit, units)}
                onChange={(qty) => update(row.key, { qty })}
              />
              <div className="flex items-end self-stretch">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('inventory.recipe.removeIngredient', { name: label })}
                  onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                >
                  <Trash aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {rows.length === 0 && <p className="text-muted-foreground">{t('inventory.addon.none')}</p>}
      <Button
        variant="outline"
        className="self-start"
        disabled={rows.length >= MAX_ADDON_INGREDIENTS}
        onClick={() => onChange([...rows, emptyRow()])}
      >
        <Plus aria-hidden="true" />
        {t('inventory.recipe.addIngredient')}
      </Button>
    </>
  );
}
