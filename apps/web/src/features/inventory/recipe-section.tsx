import type { InventoryItem, MenuItem, Recipe, Unit } from '@restroos/contracts';
import { shareBp } from '@restroos/domain';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Plus,
  SegmentedControl,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Trash,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { useErrorMessage } from '../../lib/errors';
import { usePermission } from '../auth/permissions';
import { localizedName } from '../menu/localized-name';
import { toast } from '../toast/toast-store';
import {
  INVENTORY_KEYS,
  itemsById,
  useInventoryItems,
  useRecipes,
  useUnits,
} from './inventory-queries';
import { knownUnits, unitsFor } from './quantity';
import {
  draftToLines,
  emptyRow,
  estimate,
  MAX_INGREDIENTS,
  recipeToDraft,
  rowFor,
  type RecipeDraft,
  type RecipeErrors,
  type RowProblem,
} from './recipe-form';
import { ItemSelect, QuantityField, useItemName } from './stock-controls';
import { useStockFormat } from './use-stock-format';

/** Recipes are kept by the store room; the menu editor shows them to everyone else who may see stock. */
export const RECIPE_EDIT_PERMISSION = 'inventory.manage_items';
export const RECIPE_VIEW_PERMISSIONS = ['inventory.view', 'inventory.manage_items'] as const;

/** One recipe target: the dish itself (`variantId` null) or one of its sizes. */
interface Target {
  readonly key: string;
  readonly variantId: string | null;
  /** On the size picker: "Dish (all sizes)", "Half". */
  readonly label: string;
  /** In messages: the dish's name, or the size's. */
  readonly name: string;
  readonly price: number;
}

/**
 * The Recipe section of the dish editor: what one portion takes from stock,
 * for the dish and, where they differ, for each size. A size without its own
 * recipe uses the dish's. Costs and food-cost % come from the Hub.
 */
export function RecipeSection({
  item,
  onDirtyChange,
}: {
  /** null for a dish that isn't saved yet. */
  item: MenuItem | null;
  /** Whether any recipe here has unsaved changes (for the page's leave guard). */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const canView = usePermission(RECIPE_VIEW_PERMISSIONS);
  if (!canView) return null;
  if (item === null) {
    return (
      <Card className="flex flex-col gap-1 p-4 md:p-5">
        <h2 className="text-lg font-semibold">{t('inventory.recipe.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('inventory.recipe.saveDishFirst')}</p>
      </Card>
    );
  }
  return <Recipes item={item} onDirtyChange={onDirtyChange} />;
}

function Recipes({
  item,
  onDirtyChange,
}: {
  item: MenuItem;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const canEdit = usePermission(RECIPE_EDIT_PERMISSION);
  const recipes = useRecipes(item.id);
  const items = useInventoryItems(false);
  const units = useUnits();
  const targets: Target[] = useMemo(
    () => [
      {
        key: 'dish',
        variantId: null,
        label: t('inventory.recipe.wholeDish'),
        name: localizedName(item.name, item.nameTranslations, i18n.language),
        price: item.basePrice,
      },
      ...[...item.variants]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => {
          const name = localizedName(v.name, v.nameTranslations, i18n.language);
          return { key: v.id, variantId: v.id, label: name, name, price: v.price };
        }),
    ],
    [item, t, i18n.language],
  );
  const [selected, setSelected] = useState('dish');
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
  const onDirty = useCallback((key: string, isDirty: boolean) => {
    setDirty((current) => {
      if (current.has(key) === isDirty) return current;
      const next = new Set(current);
      if (isDirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  useEffect(() => onDirtyChange(dirty.size > 0), [dirty, onDirtyChange]);

  const failed = [recipes, items].find((q) => q.isError);
  let body: ReactNode;
  if (failed !== undefined) {
    body = (
      <Alert tone="danger" role="alert">
        {errorMessage(failed.error)}
      </Alert>
    );
  } else if (recipes.data === undefined || items.data === undefined || units.isPending) {
    body = <Spinner label={t('common.loading')} />;
  } else {
    const list = recipes.data.data;
    const stock = itemsById(items.data.data);
    const known = knownUnits(units.data?.data ?? []);
    const dishRecipe = list.find((r) => r.variantId === null) ?? null;
    body = (
      <>
        {targets.length > 1 && (
          <div className="flex flex-col gap-2">
            <SegmentedControl<string>
              className="flex-wrap self-start"
              aria-label={t('inventory.recipe.for')}
              value={selected}
              onValueChange={setSelected}
              options={targets.map((target) => ({ value: target.key, label: target.label }))}
            />
            <p className="text-sm text-muted-foreground">{t('inventory.recipe.fallbackHint')}</p>
          </div>
        )}
        {targets.map((target) => (
          <div key={target.key} hidden={target.key !== selected}>
            <TargetRecipe
              dishId={item.id}
              target={target}
              recipe={list.find((r) => r.variantId === target.variantId) ?? null}
              dishRecipe={target.variantId === null ? null : dishRecipe}
              items={items.data.data}
              byId={stock}
              units={known}
              canEdit={canEdit}
              onDirty={onDirty}
            />
          </div>
        ))}
      </>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5" aria-labelledby="recipe-title" role="region">
      <div className="flex flex-col gap-1">
        <h2 id="recipe-title" className="text-lg font-semibold">
          {t('inventory.recipe.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {canEdit ? t('inventory.recipe.description') : t('inventory.recipe.readOnly')}
        </p>
      </div>
      {body}
    </Card>
  );
}

function TargetRecipe({
  dishId,
  target,
  recipe,
  dishRecipe,
  items,
  byId,
  units,
  canEdit,
  onDirty,
}: {
  dishId: string;
  target: Target;
  recipe: Recipe | null;
  /** For a size: the dish's recipe it falls back to. */
  dishRecipe: Recipe | null;
  items: readonly InventoryItem[];
  byId: ReadonlyMap<string, InventoryItem>;
  units: readonly Unit[];
  canEdit: boolean;
  onDirty: (key: string, dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [ownRecipe, setOwnRecipe] = useState(false);
  const fallsBack = target.variantId !== null && recipe === null && !ownRecipe;

  if (fallsBack) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="info">
          {dishRecipe === null
            ? t('inventory.recipe.noDishRecipe', { size: target.name })
            : t('inventory.recipe.usesDish', { size: target.name })}
        </Alert>
        {dishRecipe !== null && (
          <RecipeFigures
            recipe={dishRecipe}
            byId={byId}
            // The Hub's food cost is against the dish's price; this size has its own.
            sellingPrice={target.price}
            foodCostBp={shareBp(dishRecipe.costPerPortion, target.price)}
          />
        )}
        {canEdit && (
          <Button variant="outline" className="self-start" onClick={() => setOwnRecipe(true)}>
            <Plus aria-hidden="true" />
            {t('inventory.recipe.giveOwn', { size: target.name })}
          </Button>
        )}
      </div>
    );
  }
  if (!canEdit) {
    return recipe === null ? (
      <p className="text-sm text-muted-foreground">{t('inventory.recipe.none')}</p>
    ) : (
      <RecipeFigures
        recipe={recipe}
        byId={byId}
        sellingPrice={recipe.sellingPrice}
        foodCostBp={recipe.foodCostBp}
      />
    );
  }
  return (
    <RecipeEditor
      // A fresh form once the Hub has a new version (after a save).
      key={recipe === null ? 'new' : `${recipe.id}-${recipe.version}`}
      dishId={dishId}
      target={target}
      recipe={recipe}
      // A size's own recipe starts as a copy of the dish's.
      seed={recipe ?? (target.variantId === null ? null : dishRecipe)}
      items={items}
      byId={byId}
      units={units}
      onDirty={onDirty}
      onCancelNew={target.variantId !== null && recipe === null ? () => setOwnRecipe(false) : null}
    />
  );
}

/** A saved recipe as the Hub costs it: per ingredient, per portion and as a share of the price. */
function RecipeFigures({
  recipe,
  byId,
  sellingPrice,
  foodCostBp,
}: {
  recipe: Recipe;
  byId: ReadonlyMap<string, InventoryItem>;
  sellingPrice: number;
  foodCostBp: number | null;
}) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const name = useItemName();
  return (
    <div className="flex flex-col gap-3">
      <Table aria-label={t('inventory.recipe.ingredients')}>
        <THead>
          <Tr>
            <Th>{t('inventory.recipe.ingredient')}</Th>
            <Th className="text-end">
              {t('inventory.recipe.qtyForYield', { count: recipe.yieldPortions })}
            </Th>
            <Th className="text-end">{t('inventory.recipe.trimLoss')}</Th>
            <Th className="text-end">{t('inventory.recipe.costPerPortion')}</Th>
          </Tr>
        </THead>
        <TBody>
          {recipe.ingredients.map((i) => {
            const item = byId.get(i.inventoryItemId);
            return (
              <Tr key={i.inventoryItemId}>
                <Td>{item === undefined ? i.name : name(item)}</Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {format.qty(i.qtyMilli, i.baseUnit)}
                </Td>
                <Td className="text-end tabular-nums">
                  {i.wastageBp === 0 ? t('reports.none') : format.percent(i.wastageBp)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {format.money(i.costPerPortion)}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      <CostSummary
        costPerPortion={recipe.costPerPortion}
        sellingPrice={sellingPrice}
        foodCostBp={foodCostBp}
      />
    </div>
  );
}

/** Cost per portion, the menu price and food cost %. */
function CostSummary({
  costPerPortion,
  sellingPrice,
  foodCostBp,
  estimated = false,
}: {
  costPerPortion: number;
  sellingPrice: number;
  foodCostBp: number | null;
  estimated?: boolean;
}) {
  const { t } = useTranslation();
  const format = useStockFormat();
  return (
    <div
      role="group"
      className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm"
      aria-label={estimated ? t('inventory.recipe.estimate') : t('inventory.recipe.costs')}
      aria-live="polite"
    >
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-3">
        {[
          [t('inventory.recipe.costPerPortion'), format.money(costPerPortion)],
          [t('inventory.recipe.sellingPrice'), format.money(sellingPrice)],
          [
            t('inventory.recipe.foodCost'),
            foodCostBp === null ? t('reports.none') : format.percent(foodCostBp),
          ],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {estimated && (
        <p className="text-xs text-muted-foreground">{t('inventory.recipe.estimateHint')}</p>
      )}
    </div>
  );
}

const ROW_PROBLEMS = {
  item: 'inventory.errors.item',
  qty: 'inventory.errors.quantity',
  trim: 'validation.percent',
  duplicate: 'inventory.errors.twice',
} as const;

function RecipeEditor({
  dishId,
  target,
  recipe,
  seed,
  items,
  byId,
  units,
  onDirty,
  onCancelNew,
}: {
  dishId: string;
  target: Target;
  recipe: Recipe | null;
  seed: Recipe | null;
  items: readonly InventoryItem[];
  byId: ReadonlyMap<string, InventoryItem>;
  units: readonly Unit[];
  onDirty: (key: string, dirty: boolean) => void;
  onCancelNew: (() => void) | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const name = useItemName();
  const format = useStockFormat();
  const [initial] = useState(() => recipeToDraft(seed, units));
  const [draft, setDraft] = useState<RecipeDraft>(initial);
  const [errors, setErrors] = useState<RecipeErrors | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  // A new recipe (or a size's copy of the dish's) can be saved as it stands.
  const canSave = recipe === null || changed;
  useEffect(() => {
    onDirty(target.key, changed);
    return () => onDirty(target.key, false);
  }, [onDirty, target.key, changed]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: INVENTORY_KEYS.recipes(dishId) });
  const save = useMutation({
    mutationFn: async () => {
      const result = draftToLines(draft, units);
      if (!result.ok) {
        setErrors(result.errors);
        return null;
      }
      setErrors(null);
      const body = { yieldPortions: result.yieldPortions, ingredients: result.lines };
      return recipe === null
        ? api.inventory.createRecipe({ menuItemId: dishId, variantId: target.variantId, ...body })
        : api.inventory.updateRecipe(recipe.id, { version: recipe.version, ...body });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      toast(t('inventory.recipe.saved', { name: target.name }));
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.inventory.removeRecipe(recipe!.id, recipe!.version),
    onSuccess: () => {
      setConfirmRemove(false);
      toast(t('inventory.recipe.removed', { name: target.name }));
      void refresh();
    },
  });

  const live = estimate(draft, byId, units, target.price);
  const update = (key: string, patch: Partial<RecipeDraft['rows'][number]>) =>
    setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const problems = (key: string): readonly RowProblem[] => errors?.rows[key] ?? [];
  const busy = save.isPending || remove.isPending;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {save.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(save.error)}
          {isApiError(save.error, 'VERSION_CONFLICT') && ` ${t('common.reload')}`}
        </Alert>
      )}
      {errors?.empty === true && (
        <Alert tone="danger" role="alert">
          {t('inventory.recipe.emptyError', { max: MAX_INGREDIENTS })}
        </Alert>
      )}
      <Field
        label={t('inventory.recipe.yield')}
        hint={t('inventory.recipe.yieldHint')}
        error={errors?.yieldPortions === true ? t('inventory.errors.yield') : undefined}
        className="max-w-xs"
      >
        {(p) => (
          <Input
            {...p}
            inputMode="numeric"
            value={draft.yieldPortions}
            onChange={(e) => setDraft((d) => ({ ...d, yieldPortions: e.target.value }))}
          />
        )}
      </Field>
      <p className="text-sm text-muted-foreground">{t('inventory.recipe.trimHint')}</p>
      <ol className="flex flex-col gap-3" aria-label={t('inventory.recipe.ingredients')}>
        {draft.rows.map((row, i) => {
          const item = byId.get(row.itemId);
          const wrong = problems(row.key);
          const err = (p: RowProblem) => (wrong.includes(p) ? t(ROW_PROBLEMS[p]) : undefined);
          const label =
            item === undefined ? t('inventory.recipe.ingredientN', { n: i + 1 }) : name(item);
          const saved = recipe?.ingredients.find((x) => x.inventoryItemId === row.itemId);
          return (
            <li
              key={row.key}
              aria-label={label}
              className="grid items-start gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_7.5rem_auto]"
            >
              <Field
                label={t('inventory.recipe.ingredient')}
                error={err('item') ?? err('duplicate')}
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
                label={t('inventory.recipe.quantity')}
                {...(saved !== undefined && !changed
                  ? {
                      hint: t('inventory.recipe.rowCost', {
                        amount: format.money(saved.costPerPortion),
                      }),
                    }
                  : {})}
                error={err('qty')}
                value={row.qty}
                units={item === undefined ? [] : unitsFor(item.baseUnit, units)}
                onChange={(qty) => update(row.key, { qty })}
              />
              <Field label={t('inventory.recipe.trimLoss')} error={err('trim')}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={row.trim}
                    onChange={(e) => update(row.key, { trim: e.target.value })}
                  />
                )}
              </Field>
              <div className="flex items-end justify-end self-stretch">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('inventory.recipe.removeIngredient', { name: label })}
                  disabled={draft.rows.length === 1}
                  onClick={() =>
                    setDraft((d) => ({ ...d, rows: d.rows.filter((r) => r.key !== row.key) }))
                  }
                >
                  <Trash aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <Button
        variant="outline"
        className="self-start"
        disabled={draft.rows.length >= MAX_INGREDIENTS}
        onClick={() => setDraft((d) => ({ ...d, rows: [...d.rows, emptyRow()] }))}
      >
        <Plus aria-hidden="true" />
        {t('inventory.recipe.addIngredient')}
      </Button>
      {recipe !== null && !changed ? (
        <CostSummary
          costPerPortion={recipe.costPerPortion}
          sellingPrice={recipe.sellingPrice}
          foodCostBp={recipe.foodCostBp}
        />
      ) : (
        live !== null && (
          <CostSummary
            costPerPortion={live.costPerPortion}
            sellingPrice={target.price}
            foodCostBp={live.foodCostBp}
            estimated
          />
        )
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !canSave}>
          {save.isPending ? t('common.saving') : t('inventory.recipe.save')}
        </Button>
        {recipe !== null && (
          <Button variant="outline" disabled={busy} onClick={() => setConfirmRemove(true)}>
            {t('inventory.recipe.remove')}
          </Button>
        )}
        {onCancelNew !== null && (
          <Button variant="ghost" disabled={busy} onClick={onCancelNew}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
      {confirmRemove && (
        <ConfirmDialog
          title={t('inventory.recipe.removeTitle', { name: target.name })}
          body={
            target.variantId === null
              ? t('inventory.recipe.removeDishBody')
              : t('inventory.recipe.removeSizeBody', { size: target.name })
          }
          confirmLabel={t('inventory.recipe.remove')}
          destructive
          busy={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirmRemove(false)}
        />
      )}
    </form>
  );
}
