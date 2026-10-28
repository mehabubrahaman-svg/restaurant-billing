import type { InventoryItem, StockCount, Unit } from '@restroos/contracts';
import { divideRounded, MILLI_PER_BASE_THOUSAND, stockValue, toSafeNumber } from '@restroos/domain';
import {
  Alert,
  ArrowLeft,
  Button,
  Card,
  cn,
  Input,
  Search,
  SegmentedControl,
  Select,
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
import { Link, useParams } from 'react-router';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { UnsavedChangesDialog } from '../../components/unsaved-changes-dialog';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import {
  INVENTORY_KEYS,
  invalidateStock,
  itemsById,
  storeCount,
  useInventoryItems,
  useStockCount,
  useUnits,
} from '../../features/inventory/inventory-queries';
import {
  knownUnits,
  parseQuantity,
  preferredUnit,
  quantityText,
  unitsFor,
} from '../../features/inventory/quantity';
import {
  byCategory,
  useItemName,
  type QuantityDraft,
} from '../../features/inventory/stock-controls';
import { useStockFormat } from '../../features/inventory/use-stock-format';
import { useDayFormat } from '../../features/reports/use-day-format';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard';
import { COUNT_PERMISSION, CountStatus, CountValue } from './count-parts';
import { ADJUST_PERMISSION } from './inventory-layout';

type Line = StockCount['lines'][number];
type Show = 'all' | 'counted' | 'uncounted' | 'different';
const SHOWS: readonly Show[] = ['all', 'uncounted', 'counted', 'different'];

/** /inventory/counts/:countId: the count sheet; read-only once posted. */
export function CountSheetPage() {
  const { t } = useTranslation();
  const { countId = '' } = useParams();
  const count = useStockCount(countId);
  // Retired items stay on sheets they were counted on; their costs come from here.
  const items = useInventoryItems(true);
  const units = useUnits();
  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/inventory/counts"
        className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('inventory.counts.back')}
      </Link>
      <QueryState query={count}>
        {(c) => (
          <CountSheet
            count={c}
            items={itemsById(items.data?.data ?? [])}
            units={knownUnits(units.data?.data ?? [])}
          />
        )}
      </QueryState>
    </div>
  );
}

/** The line's counted quantity as the sheet shows it: in the unit the item is bought in. */
function lineDraft(
  line: Line,
  item: InventoryItem | undefined,
  units: readonly Unit[],
): QuantityDraft {
  const unit = preferredUnit(item ?? { baseUnit: line.baseUnit, purchaseUnitId: null }, units);
  if (line.countedQtyMilli === null) return { text: '', unitId: unit.id };
  const text = quantityText(line.countedQtyMilli, unit.toBaseMilli);
  if (text !== null) return { text, unitId: unit.id };
  const base = preferredUnit({ baseUnit: line.baseUnit, purchaseUnitId: null }, units);
  return { text: quantityText(line.countedQtyMilli, base.toBaseMilli) ?? '', unitId: base.id };
}

/** Counted milli-units of a typed draft: null when blank, undefined when unreadable. */
function countedOf(draft: QuantityDraft, units: readonly Unit[]): number | null | undefined {
  if (draft.text.trim() === '') return null;
  const unit = units.find((u) => u.id === draft.unitId);
  const milli = unit === undefined ? null : parseQuantity(draft.text, unit.toBaseMilli);
  return milli === null ? undefined : milli;
}

function CountSheet({
  count,
  items,
  units,
}: {
  count: StockCount;
  items: ReadonlyMap<string, InventoryItem>;
  units: readonly Unit[];
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const stock = useStockFormat();
  const itemName = useItemName();
  const day = useDayFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canCount = usePermission(COUNT_PERMISSION);
  const canPost = usePermission(ADJUST_PERMISSION);
  const draft = count.status === 'DRAFT';
  const editable = draft && canCount;
  // Only what was typed here; everything else comes from the Hub's copy of the sheet.
  const [edits, setEdits] = useState<ReadonlyMap<string, QuantityDraft>>(new Map());
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [confirmPost, setConfirmPost] = useState(false);

  const draftOf = (line: Line) =>
    edits.get(line.inventoryItemId) ?? lineDraft(line, items.get(line.inventoryItemId), units);
  const countedNow = (line: Line) => {
    const edit = edits.get(line.inventoryItemId);
    return edit === undefined ? line.countedQtyMilli : countedOf(edit, units);
  };
  const changes = count.lines.flatMap((line) => {
    const edit = edits.get(line.inventoryItemId);
    if (edit === undefined) return [];
    const counted = countedOf(edit, units);
    return counted === line.countedQtyMilli ? [] : [{ line, counted }];
  });
  const dirty = changes.length > 0;
  const { blocker } = useUnsavedGuard(dirty);

  /** The difference now: counted − books, and its value at today's average cost. */
  const variance = (line: Line) => {
    if (!draft) return { milli: line.varianceMilli, value: line.varianceValue };
    const counted = countedNow(line);
    if (counted === null || counted === undefined) return { milli: null, value: null };
    const milli = counted - line.systemQtyMilli;
    const cost = items.get(line.inventoryItemId)?.avgCostPerBase ?? 0;
    return { milli, value: stockValue(milli, cost) };
  };
  const sums = count.lines.reduce(
    (sum, line) => {
      const v = variance(line);
      if (v.milli === null) return sum;
      const cost = items.get(line.inventoryItemId)?.avgCostPerBase ?? 0;
      return { counted: sum.counted + 1, raw: sum.raw + BigInt(v.milli) * BigInt(cost) };
    },
    { counted: 0, raw: 0n },
  );
  // Rounded once, the way the Hub values the posted count (each line is rounded on its own).
  const totals = {
    counted: sums.counted,
    value: toSafeNumber(divideRounded(sums.raw, MILLI_PER_BASE_THOUSAND, 'HALF_EVEN'), 'value'),
  };

  /** Saves what changed: the count as the Hub has it afterwards, or null if a quantity is unreadable. */
  async function saveChanges(): Promise<StockCount | null> {
    const unreadable = changes.filter((c) => c.counted === undefined);
    if (unreadable.length > 0) {
      setInvalid(new Set(unreadable.map((c) => c.line.inventoryItemId)));
      return null;
    }
    setInvalid(new Set());
    if (changes.length === 0) return count;
    const saved = await api.inventory.saveCountLines(count.id, {
      version: count.version,
      lines: changes.map((c) => ({
        inventoryItemId: c.line.inventoryItemId,
        countedQtyMilli: c.counted ?? null,
      })),
    });
    storeCount(queryClient, saved);
    setEdits(new Map());
    return saved;
  }

  const save = useMutation({
    mutationFn: saveChanges,
    onSuccess: (saved) => {
      if (saved !== null) toast(t('inventory.counts.saved'));
    },
  });
  const post = useMutation({
    mutationFn: async () => {
      const saved = await saveChanges();
      return saved === null ? null : api.inventory.postCount(saved.id, saved.version);
    },
    onSuccess: (posted) => {
      setConfirmPost(false);
      if (posted === null) return;
      storeCount(queryClient, posted);
      void invalidateStock(queryClient);
      toast(t('inventory.counts.posted'));
    },
    onError: (error) => {
      if (isApiError(error, 'INVALID_STATE_TRANSITION')) {
        void queryClient.invalidateQueries({ queryKey: INVENTORY_KEYS.count(count.id) });
      }
    },
  });
  const failed = [save, post].find((m) => m.isError);
  const problem =
    failed === undefined
      ? null
      : isApiError(failed.error, 'INVALID_STATE_TRANSITION')
        ? t('inventory.counts.alreadyPosted')
        : errorMessage(failed.error);

  const name = (line: Line) => {
    const item = items.get(line.inventoryItemId);
    return item === undefined ? line.name : itemName(item);
  };
  const needle = query.trim().toLowerCase();
  const shown = count.lines.filter((line) => {
    if (
      needle !== '' &&
      ![line.name, line.sku, name(line)].some((s) => s.toLowerCase().includes(needle))
    )
      return false;
    const counted = countedNow(line);
    if (show === 'counted') return counted !== null;
    if (show === 'uncounted') return counted === null;
    if (show === 'different') {
      const v = variance(line).milli;
      return v !== null && v !== 0;
    }
    return true;
  });

  const title = t(`inventory.counts.sheetTitles.${count.countType}`, {
    date: day(count.businessDate),
  });

  return (
    <>
      <AdminHeader
        title={title}
        {...(count.notes === null ? {} : { description: count.notes })}
        actions={
          draft ? (
            <>
              {editable && (
                <Button
                  variant="outline"
                  disabled={!dirty || save.isPending || post.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? t('common.saving') : t('inventory.counts.save')}
                </Button>
              )}
              {canPost && (
                <Button
                  disabled={totals.counted === 0 || save.isPending || post.isPending}
                  onClick={() => setConfirmPost(true)}
                >
                  {t('inventory.counts.post')}
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <CountStatus count={count} />
        {count.status === 'POSTED' ? (
          <span className="text-muted-foreground">
            {t('inventory.counts.postedBy', {
              name: count.postedByName ?? t('reports.none'),
              time: format.dateTime(count.postedAt ?? count.createdAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {editable ? t('inventory.counts.draftHint') : t('inventory.counts.readOnlyHint')}
          </span>
        )}
      </div>
      {problem !== null && (
        <Alert tone="danger" role="alert">
          {problem}
          {isApiError(failed?.error, 'VERSION_CONFLICT') && (
            <Button
              variant="outline"
              size="sm"
              className="ms-2"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: INVENTORY_KEYS.count(count.id) })
              }
            >
              {t('common.reload')}
            </Button>
          )}
        </Alert>
      )}
      {invalid.size > 0 && (
        <Alert tone="danger" role="alert">
          {t('inventory.counts.unreadable', { count: invalid.size })}
        </Alert>
      )}

      <dl className="grid gap-3 sm:grid-cols-3">
        <Card className="flex flex-col gap-1 p-4">
          <dt className="text-sm text-muted-foreground">{t('inventory.counts.countedSoFar')}</dt>
          <dd className="text-xl font-bold tabular-nums">
            {t('inventory.counts.countedOf', {
              counted: format.number(totals.counted),
              total: format.number(count.lines.length),
            })}
          </dd>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <dt className="text-sm text-muted-foreground">{t('inventory.counts.varianceValue')}</dt>
          <dd className="text-xl font-bold">
            <CountValue paise={draft ? totals.value : count.varianceValue} />
          </dd>
        </Card>
        {editable && (
          <Card className="flex flex-col gap-1 p-4">
            <dt className="text-sm text-muted-foreground">{t('inventory.counts.unsaved')}</dt>
            <dd className="text-xl font-bold tabular-nums">{format.number(changes.length)}</dd>
          </Card>
        )}
      </dl>

      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-60 flex-1 sm:max-w-sm">
          <span className="sr-only">{t('inventory.items.search')}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            className="ps-10"
            autoComplete="off"
            placeholder={t('inventory.items.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <SegmentedControl<Show>
          aria-label={t('inventory.counts.show')}
          size="sm"
          value={show}
          onValueChange={setShow}
          options={SHOWS.map((s) => ({ value: s, label: t(`inventory.counts.shows.${s}`) }))}
        />
      </div>
      {draft && <p className="text-sm text-muted-foreground">{t('inventory.counts.booksHint')}</p>}

      {shown.length === 0 ? (
        <p className="text-muted-foreground">{t('inventory.counts.nothingShown')}</p>
      ) : (
        <Table aria-label={t('inventory.counts.sheet')}>
          <THead>
            <Tr>
              <Th>{t('inventory.fields.item')}</Th>
              <Th className="text-end">{t('inventory.counts.system')}</Th>
              <Th>{t('inventory.counts.countedQty')}</Th>
              <Th className="text-end">{t('inventory.counts.variance')}</Th>
            </Tr>
          </THead>
          {byCategory(shown).map((group) => (
            <TBody key={group.category ?? ''}>
              <Tr className="bg-muted/50">
                <Th scope="rowgroup" colSpan={4} className="text-sm">
                  {group.category ?? t('inventory.uncategorised')}
                </Th>
              </Tr>
              {group.items.map((line) => {
                const v = variance(line);
                const choices = unitsFor(line.baseUnit, units);
                const value = draftOf(line);
                const unit = choices.find((u) => u.id === value.unitId) ?? choices[0]!;
                const label = name(line);
                return (
                  <Tr key={line.inventoryItemId}>
                    <Td>
                      <span className="font-medium break-words">{label}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {line.sku}
                      </span>
                    </Td>
                    <Td className="text-end whitespace-nowrap tabular-nums">
                      {stock.qtyIn(line.systemQtyMilli, unit, line.baseUnit)}
                    </Td>
                    <Td>
                      {editable ? (
                        <div className="flex max-w-72 min-w-44 gap-2">
                          <Input
                            aria-label={t('inventory.counts.countedFor', { name: label })}
                            aria-invalid={invalid.has(line.inventoryItemId) ? true : undefined}
                            inputMode="decimal"
                            autoComplete="off"
                            className="min-w-0 flex-1 tabular-nums"
                            value={value.text}
                            onChange={(e) =>
                              setEdits((m) =>
                                new Map(m).set(line.inventoryItemId, {
                                  ...value,
                                  text: e.target.value,
                                }),
                              )
                            }
                          />
                          {choices.length > 1 && (
                            <Select
                              aria-label={t('inventory.fields.unitOf', { field: label })}
                              className="w-24 shrink-0"
                              value={value.unitId}
                              onChange={(e) =>
                                setEdits((m) =>
                                  new Map(m).set(line.inventoryItemId, {
                                    ...value,
                                    unitId: e.target.value,
                                  }),
                                )
                              }
                            >
                              {choices.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {stock.unitLabel(u.code)}
                                </option>
                              ))}
                            </Select>
                          )}
                        </div>
                      ) : line.countedQtyMilli === null ? (
                        <span className="text-muted-foreground">
                          {t('inventory.counts.notCounted')}
                        </span>
                      ) : (
                        <span className="tabular-nums">
                          {stock.qtyIn(line.countedQtyMilli, unit, line.baseUnit)}
                        </span>
                      )}
                    </Td>
                    <Td className="text-end">
                      {v.milli === null ? (
                        <span className="text-muted-foreground">{t('reports.none')}</span>
                      ) : (
                        <span className="flex flex-col items-end">
                          <span
                            className={cn(
                              'whitespace-nowrap tabular-nums',
                              v.milli < 0 && 'text-state-danger-fg',
                              v.milli > 0 && 'text-state-available-fg',
                              v.milli === 0 && 'text-muted-foreground',
                            )}
                          >
                            {v.milli === 0
                              ? t('inventory.counts.matches')
                              : stock.qtyIn(v.milli, unit, line.baseUnit, true)}
                          </span>
                          {v.value !== null && v.milli !== 0 && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {stock.money(v.value)}
                            </span>
                          )}
                        </span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          ))}
        </Table>
      )}

      <UnsavedChangesDialog blocker={blocker} />
      {confirmPost && (
        <ConfirmDialog
          title={t('inventory.counts.postTitle')}
          body={
            <div className="flex flex-col gap-2">
              <p>
                {t('inventory.counts.postBody', {
                  counted: totals.counted,
                  value: stock.money(totals.value),
                })}
              </p>
              {dirty && <p className="text-muted-foreground">{t('inventory.counts.postSaves')}</p>}
            </div>
          }
          confirmLabel={t('inventory.counts.post')}
          busy={post.isPending}
          error={post.isError ? problem : null}
          onConfirm={() => post.mutate()}
          onClose={() => setConfirmPost(false)}
        />
      )}
    </>
  );
}
