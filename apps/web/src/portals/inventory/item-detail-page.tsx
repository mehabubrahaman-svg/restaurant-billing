import { MovementTypeSchema, type InventoryItem, type MovementType } from '@restroos/contracts';
import {
  Alert,
  ArrowLeft,
  Badge,
  Button,
  Card,
  cn,
  Field,
  Pencil,
  Select,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import {
  useInventoryItem,
  useInventoryItems,
  useUnits,
  useMovements,
} from '../../features/inventory/inventory-queries';
import { LevelBadge, useItemName } from '../../features/inventory/stock-controls';
import { useStockFormat } from '../../features/inventory/use-stock-format';
import { useDayFormat } from '../../features/reports/use-day-format';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { MANAGE_PERMISSION } from './inventory-layout';
import { ItemDialog } from './item-dialog';

const TYPES = MovementTypeSchema.options;

/** /inventory/items/:itemId: one item's balance, levels and every movement, newest first. */
export function ItemDetailPage() {
  const { t } = useTranslation();
  const { itemId = '' } = useParams();
  const item = useInventoryItem(itemId);
  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/inventory"
        className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('inventory.items.back')}
      </Link>
      <QueryState query={item}>{(data) => <ItemDetail item={data} />}</QueryState>
    </div>
  );
}

function ItemDetail({ item }: { item: InventoryItem }) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const name = useItemName();
  const canManage = usePermission(MANAGE_PERMISSION);
  // Loaded ahead, so the edit dialog opens at once.
  useUnits();
  const [editing, setEditing] = useState(false);
  // For the category suggestions in the edit dialog.
  const all = useInventoryItems(false);
  const categories = [
    ...new Set((all.data?.data ?? []).flatMap((i) => (i.category === null ? [] : [i.category]))),
  ];
  const shown = name(item);

  return (
    <>
      <AdminHeader
        title={shown}
        description={[item.sku, item.category, shown === item.name ? null : item.name]
          .filter((s) => s !== null)
          .join(' · ')}
        actions={
          canManage ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              {t('common.edit')}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap gap-2">
        <LevelBadge level={item.level} />
        {!item.isActive && <Badge>{t('common.retired')}</Badge>}
        {item.isPerishable && (
          <Badge variant="warning">
            {item.shelfLifeDays === null
              ? t('inventory.fields.perishable')
              : t('inventory.item.shelfLifeBadge', { count: item.shelfLifeDays })}
          </Badge>
        )}
      </div>
      {item.qtyMilli < 0 && <Alert tone="danger">{t('inventory.alerts.negativeHint')}</Alert>}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('inventory.fields.onHand'), format.qty(item.qtyMilli, item.baseUnit)],
          [
            t('inventory.fields.avgCost'),
            item.avgCostPerBase === 0
              ? t('reports.none')
              : format.perUnit(item.avgCostPerBase, item.baseUnit),
          ],
          [t('inventory.fields.value'), format.money(item.value)],
          [
            t('inventory.fields.levels'),
            t('inventory.item.levelsValue', {
              reorder:
                item.reorderLevelMilli === 0
                  ? t('reports.none')
                  : format.qty(item.reorderLevelMilli, item.baseUnit),
              max:
                item.maxLevelMilli === null
                  ? t('reports.none')
                  : format.qty(item.maxLevelMilli, item.baseUnit),
            }),
          ],
        ].map(([label, value]) => (
          <Card key={label} className="flex flex-col gap-1 p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-xl font-bold break-words tabular-nums">{value}</dd>
          </Card>
        ))}
      </dl>
      <Movements item={item} />
      {editing && (
        <ItemDialog item={item} categories={categories} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

function Movements({ item }: { item: InventoryItem }) {
  const { t } = useTranslation();
  const format = useFormat();
  const stock = useStockFormat();
  const day = useDayFormat();
  const errorMessage = useErrorMessage();
  const [type, setType] = useState<MovementType | ''>('');
  const pages = useMovements({
    inventoryItemId: item.id,
    ...(type === '' ? {} : { type }),
  });
  const rows = pages.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <section aria-labelledby="movements" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="movements" className="text-lg font-semibold">
          {t('inventory.movements.title')}
        </h2>
        <Field label={t('inventory.movements.type')} className="w-full sm:w-56">
          {(p) => (
            <Select
              {...p}
              value={type}
              onChange={(e) => setType(e.target.value as MovementType | '')}
            >
              <option value="">{t('inventory.movements.allTypes')}</option>
              {TYPES.map((m) => (
                <option key={m} value={m}>
                  {t(`inventory.movementTypes.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {pages.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : pages.isError && rows.length === 0 ? (
        <Alert tone="danger" role="alert">
          {errorMessage(pages.error)}
        </Alert>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">{t('inventory.movements.empty')}</p>
      ) : (
        <Table aria-label={t('inventory.movements.title')}>
          <THead>
            <Tr>
              <Th>{t('inventory.movements.when')}</Th>
              <Th>{t('inventory.movements.type')}</Th>
              <Th className="text-end">{t('inventory.movements.qty')}</Th>
              <Th className="text-end">{t('inventory.movements.balance')}</Th>
              <Th className="text-end">{t('inventory.fields.value')}</Th>
              <Th>{t('inventory.movements.details')}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((m) => (
              <Tr key={m.id}>
                <Td className="whitespace-nowrap">
                  {day(m.businessDate)}
                  <span className="block text-xs text-muted-foreground">
                    {format.dateTime(m.createdAt, { timeStyle: 'short' })}
                  </span>
                </Td>
                <Td>{t(`inventory.movementTypes.${m.type}`)}</Td>
                <Td
                  className={cn(
                    'text-end whitespace-nowrap tabular-nums',
                    m.qtyMilli < 0 ? 'text-state-danger-fg' : 'text-state-available-fg',
                  )}
                >
                  {stock.qty(m.qtyMilli, m.baseUnit, true)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {stock.qty(m.balanceAfterMilli, m.baseUnit)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">{stock.money(m.value)}</Td>
                <Td className="text-sm">
                  {[
                    // A count's adjustments carry the Hub's own English reason: say it in the user's language.
                    m.referenceType === 'STOCK_COUNT'
                      ? t('inventory.movements.fromCount')
                      : m.reason,
                    m.batchNo === null
                      ? null
                      : t('inventory.movements.batch', { batch: m.batchNo }),
                    m.createdByName,
                  ]
                    .filter((s) => s !== null)
                    .join(' · ') || t('reports.none')}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {pages.hasNextPage && (
        <Button
          variant="outline"
          className="self-start"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {pages.isFetchingNextPage ? t('common.loading') : t('inventory.movements.older')}
        </Button>
      )}
      {pages.isFetchNextPageError && (
        <Alert tone="danger" role="alert">
          {errorMessage(pages.error)}
        </Alert>
      )}
    </section>
  );
}
