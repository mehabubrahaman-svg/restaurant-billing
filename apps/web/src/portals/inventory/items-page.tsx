import type { InventoryItem, StockLevel } from '@restroos/contracts';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Field,
  Input,
  Pencil,
  Plus,
  Search,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { useInventoryItems, useUnits } from '../../features/inventory/inventory-queries';
import { byCategory, LevelBadge, useItemName } from '../../features/inventory/stock-controls';
import { useStockFormat } from '../../features/inventory/use-stock-format';
import { MANAGE_PERMISSION } from './inventory-layout';
import { ItemDialog } from './item-dialog';

type Sort = 'category' | 'name' | 'value' | 'level';
const SORTS: readonly Sort[] = ['category', 'name', 'value', 'level'];
/** Most urgent first. */
const URGENCY: Record<StockLevel, number> = { OUT: 0, LOW: 1, OVER: 2, OK: 3 };

/** /inventory: every stock item with what is on hand, its level, average cost and value. */
export function ItemsPage() {
  const { t } = useTranslation();
  const canManage = usePermission(MANAGE_PERMISSION);
  // Loaded ahead, so the item dialog opens at once (units rarely change: cached for the session).
  useUnits();
  const [showRetired, setShowRetired] = useState(false);
  const items = useInventoryItems(showRetired);
  const [editing, setEditing] = useState<InventoryItem | 'new' | null>(null);
  const categories = useMemo(
    () => [
      ...new Set(
        (items.data?.data ?? []).flatMap((i) => (i.category === null ? [] : [i.category])),
      ),
    ],
    [items.data],
  );

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('inventory.items.title')}
        description={t('inventory.items.description')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              {t('inventory.item.add')}
            </Button>
          ) : undefined
        }
      />
      <QueryState query={items}>
        {({ data }) => (
          <ItemsList
            items={data}
            showRetired={showRetired}
            onShowRetired={setShowRetired}
            onEdit={canManage ? setEditing : null}
          />
        )}
      </QueryState>
      {editing !== null && (
        <ItemDialog
          item={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ItemsList({
  items,
  showRetired,
  onShowRetired,
  onEdit,
}: {
  items: readonly InventoryItem[];
  showRetired: boolean;
  onShowRetired: (v: boolean) => void;
  onEdit: ((item: InventoryItem) => void) | null;
}) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const name = useItemName();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('category');

  const active = items.filter((i) => i.isActive);
  const totalValue = active.reduce((sum, i) => sum + i.value, 0);
  const toReorder = active.filter((i) => i.level === 'OUT' || i.level === 'LOW').length;

  const needle = query.trim().toLowerCase();
  const shown = items
    .filter(
      (i) =>
        needle === '' ||
        [
          i.name,
          i.sku,
          i.category ?? '',
          i.nameTranslations.hi ?? '',
          i.nameTranslations.bn ?? '',
        ].some((text) => text.toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      if (sort === 'value') return b.value - a.value;
      if (sort === 'level') return URGENCY[a.level] - URGENCY[b.level];
      if (sort === 'name') return name(a).localeCompare(name(b));
      return 0; // the Hub's order: category, then name
    });
  const groups = sort === 'category' ? byCategory(shown) : [{ category: null, items: shown }];

  if (items.length === 0 && !showRetired) {
    return (
      <Card className="p-5">
        <p className="text-muted-foreground">{t('inventory.items.empty')}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          [t('inventory.items.totalValue'), format.money(totalValue)],
          [
            t('inventory.items.itemCount'),
            t('inventory.items.itemCountValue', { count: active.length }),
          ],
          [
            t('inventory.items.toReorder'),
            t('inventory.items.toReorderValue', { count: toReorder }),
          ],
        ].map(([label, value]) => (
          <Card key={label} className="flex flex-col gap-1 p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-xl font-bold break-words tabular-nums">{value}</dd>
          </Card>
        ))}
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
        <Field label={t('inventory.items.sortBy')} className="w-full sm:w-48">
          {(p) => (
            <Select {...p} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`inventory.items.sorts.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox
          label={t('inventory.items.showRetired')}
          checked={showRetired}
          onChange={(e) => onShowRetired(e.target.checked)}
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground">{t('inventory.items.noMatch', { q: query.trim() })}</p>
      ) : (
        <Table aria-label={t('inventory.items.title')}>
          <THead>
            <Tr>
              <Th>{t('inventory.fields.item')}</Th>
              <Th className="text-end">{t('inventory.fields.onHand')}</Th>
              <Th>{t('inventory.fields.level')}</Th>
              <Th className="text-end">{t('inventory.fields.avgCost')}</Th>
              <Th className="text-end">{t('inventory.fields.value')}</Th>
              {onEdit !== null && (
                <Th>
                  <span className="sr-only">{t('inventory.fields.actions')}</span>
                </Th>
              )}
            </Tr>
          </THead>
          {groups.map((group) => (
            <TBody key={group.category ?? ''}>
              {sort === 'category' && (
                <Tr className="bg-muted/50">
                  <Th scope="rowgroup" colSpan={onEdit === null ? 5 : 6} className="text-sm">
                    {group.category ?? t('inventory.uncategorised')}
                  </Th>
                </Tr>
              )}
              {group.items.map((item) => (
                <ItemRow key={item.id} item={item} onEdit={onEdit} />
              ))}
            </TBody>
          ))}
        </Table>
      )}
    </div>
  );
}

function ItemRow({
  item,
  onEdit,
}: {
  item: InventoryItem;
  onEdit: ((item: InventoryItem) => void) | null;
}) {
  const { t, i18n } = useTranslation();
  const format = useStockFormat();
  const name = useItemName();
  const shown = name(item);
  return (
    <Tr className={cn(!item.isActive && 'text-muted-foreground')}>
      <Td>
        <Link
          to={`/inventory/items/${item.id}`}
          className="font-medium break-words text-primary underline-offset-2 hover:underline"
        >
          {shown}
        </Link>
        <span className="block text-xs text-muted-foreground">
          <span className="font-mono">{item.sku}</span>
          {shown !== item.name && i18n.language !== 'en-IN' && (
            <span lang="en-IN"> · {item.name}</span>
          )}
        </span>
        {!item.isActive && <Badge className="mt-1">{t('common.retired')}</Badge>}
      </Td>
      <Td
        className={cn(
          'text-end whitespace-nowrap tabular-nums',
          item.qtyMilli < 0 && 'font-semibold text-state-danger-fg',
        )}
      >
        {format.qty(item.qtyMilli, item.baseUnit)}
      </Td>
      <Td>
        <LevelBadge level={item.level} />
      </Td>
      <Td className="text-end whitespace-nowrap tabular-nums">
        {item.avgCostPerBase === 0
          ? t('reports.none')
          : format.perUnit(item.avgCostPerBase, item.baseUnit)}
      </Td>
      <Td className="text-end whitespace-nowrap tabular-nums">{format.money(item.value)}</Td>
      {onEdit !== null && (
        <Td className="text-end">
          <Button
            size="sm"
            variant="outline"
            aria-label={t('inventory.item.editNamed', { name: shown })}
            onClick={() => onEdit(item)}
          >
            <Pencil aria-hidden="true" />
            {t('common.edit')}
          </Button>
        </Td>
      )}
    </Tr>
  );
}
