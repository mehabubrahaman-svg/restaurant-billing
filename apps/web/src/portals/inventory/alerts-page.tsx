import type { StockAlerts } from '@restroos/contracts';
import { Alert, Badge, CircleCheck, cn, Table, TBody, Td, Th, THead, Tr } from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import {
  itemsById,
  useInventoryItems,
  useStockAlerts,
} from '../../features/inventory/inventory-queries';
import { LevelBadge, useItemName } from '../../features/inventory/stock-controls';
import { useStockFormat } from '../../features/inventory/use-stock-format';
import { useDayFormat } from '../../features/reports/use-day-format';
import { ADJUST_PERMISSION } from './inventory-layout';

/** /inventory/alerts: what to reorder, what went negative and what is about to spoil. */
export function AlertsPage() {
  const { t } = useTranslation();
  const day = useDayFormat();
  const alerts = useStockAlerts();
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('inventory.alerts.title')}
        description={
          alerts.data === undefined
            ? t('inventory.alerts.description')
            : t('inventory.alerts.asOf', {
                date: day(alerts.data.businessDate, { dateStyle: 'full' }),
              })
        }
      />
      <QueryState query={alerts}>{(data) => <AlertSections alerts={data} />}</QueryState>
    </div>
  );
}

function AlertSections({ alerts }: { alerts: StockAlerts }) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const day = useDayFormat();
  const canAdjust = usePermission(ADJUST_PERMISSION);
  // Alerts carry the English name; the item list has the translations.
  const items = itemsById(useInventoryItems(false).data?.data ?? []);
  const itemName = useItemName();
  const reorder = alerts.levels.filter((l) => l.level !== 'OVER');
  const over = alerts.levels.filter((l) => l.level === 'OVER');
  const link = (id: string, name: string) => {
    const item = items.get(id);
    return (
      <Link
        to={`/inventory/items/${id}`}
        className="font-medium break-words text-primary underline-offset-2 hover:underline"
      >
        {item === undefined ? name : itemName(item)}
      </Link>
    );
  };
  const action = (id: string, kind: 'receive' | 'wastage', label: string) =>
    canAdjust ? (
      <Link
        to={`/inventory/stock?kind=${kind}&item=${id}`}
        className="text-sm font-medium whitespace-nowrap text-primary underline-offset-2 hover:underline"
      >
        {label}
      </Link>
    ) : null;

  if (alerts.levels.length === 0 && alerts.negative.length === 0 && alerts.expiring.length === 0) {
    return (
      <Alert tone="success" title={t('inventory.alerts.allClear')}>
        {t('inventory.alerts.allClearBody')}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        id="alerts-reorder"
        title={t('inventory.alerts.reorder')}
        count={reorder.length}
        empty={t('inventory.alerts.noReorder')}
      >
        <Table>
          <THead>
            <Tr>
              <Th>{t('inventory.fields.item')}</Th>
              <Th className="text-end">{t('inventory.fields.onHand')}</Th>
              <Th className="text-end">{t('inventory.fields.reorderLevel')}</Th>
              <Th>{t('inventory.fields.level')}</Th>
              <Th>
                <span className="sr-only">{t('inventory.fields.actions')}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {reorder.map((l) => (
              <Tr key={l.inventoryItemId}>
                <Td>
                  {link(l.inventoryItemId, l.name)}
                  <span className="block font-mono text-xs text-muted-foreground">{l.sku}</span>
                </Td>
                <Td
                  className={cn(
                    'text-end whitespace-nowrap tabular-nums',
                    l.qtyMilli < 0 && 'font-semibold text-state-danger-fg',
                  )}
                >
                  {format.qty(l.qtyMilli, l.baseUnit)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {l.reorderLevelMilli === 0
                    ? t('reports.none')
                    : format.qty(l.reorderLevelMilli, l.baseUnit)}
                </Td>
                <Td>
                  <LevelBadge level={l.level} />
                </Td>
                <Td className="text-end">
                  {action(l.inventoryItemId, 'receive', t('inventory.alerts.receive'))}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section
        id="alerts-negative"
        title={t('inventory.alerts.negative')}
        description={t('inventory.alerts.negativeHint')}
        count={alerts.negative.length}
        empty={t('inventory.alerts.noNegative')}
        tone="danger"
      >
        <Table>
          <THead>
            <Tr>
              <Th>{t('inventory.fields.item')}</Th>
              <Th className="text-end">{t('inventory.fields.onHand')}</Th>
            </Tr>
          </THead>
          <TBody>
            {alerts.negative.map((n) => (
              <Tr key={n.inventoryItemId}>
                <Td>
                  {link(n.inventoryItemId, n.name)}
                  <span className="block font-mono text-xs text-muted-foreground">{n.sku}</span>
                </Td>
                <Td className="text-end font-semibold whitespace-nowrap text-state-danger-fg tabular-nums">
                  {format.qty(n.qtyMilli, n.baseUnit)}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section
        id="alerts-expiring"
        title={t('inventory.alerts.expiring')}
        description={t('inventory.alerts.expiringHint')}
        count={alerts.expiring.length}
        empty={t('inventory.alerts.noExpiring')}
      >
        <Table>
          <THead>
            <Tr>
              <Th>{t('inventory.fields.item')}</Th>
              <Th>{t('inventory.entry.batchNo')}</Th>
              <Th>{t('inventory.entry.expiresOn')}</Th>
              <Th className="text-end">{t('inventory.alerts.remaining')}</Th>
              <Th className="text-end">{t('inventory.fields.value')}</Th>
              <Th>
                <span className="sr-only">{t('inventory.fields.actions')}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {alerts.expiring.map((b) => (
              <Tr
                key={b.batchId}
                data-expired={b.expired}
                className={cn(b.expired && 'bg-state-danger-soft')}
              >
                <Td>{link(b.inventoryItemId, b.name)}</Td>
                <Td className="font-mono text-sm">{b.batchNo ?? t('reports.none')}</Td>
                <Td className="whitespace-nowrap">
                  <span className="flex flex-wrap items-center gap-2">
                    {day(b.expiresOn)}
                    {b.expired ? (
                      <Badge variant="danger">{t('inventory.alerts.expired')}</Badge>
                    ) : (
                      <Badge variant="warning">{t('inventory.alerts.expiresSoon')}</Badge>
                    )}
                  </span>
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {format.qty(b.remainingMilli, b.baseUnit)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">{format.money(b.value)}</Td>
                <Td className="text-end">
                  {b.expired &&
                    action(b.inventoryItemId, 'wastage', t('inventory.alerts.writeOff'))}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      {over.length > 0 && (
        <Section
          id="alerts-over"
          title={t('inventory.alerts.over')}
          description={t('inventory.alerts.overHint')}
          count={over.length}
          empty=""
        >
          <Table>
            <THead>
              <Tr>
                <Th>{t('inventory.fields.item')}</Th>
                <Th className="text-end">{t('inventory.fields.onHand')}</Th>
                <Th className="text-end">{t('inventory.fields.maxLevel')}</Th>
              </Tr>
            </THead>
            <TBody>
              {over.map((l) => (
                <Tr key={l.inventoryItemId}>
                  <Td>{link(l.inventoryItemId, l.name)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {format.qty(l.qtyMilli, l.baseUnit)}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {l.maxLevelMilli === null
                      ? t('reports.none')
                      : format.qty(l.maxLevelMilli, l.baseUnit)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </div>
  );
}

function Section({
  id,
  title,
  description,
  count,
  empty,
  tone,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  count: number;
  empty: string;
  tone?: 'danger';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {count > 0 && (
          <Badge variant={tone === 'danger' ? 'danger' : 'warning'} className="tabular-nums">
            {t('inventory.alerts.count', { count })}
          </Badge>
        )}
      </div>
      {description !== undefined && <p className="text-sm text-muted-foreground">{description}</p>}
      {count === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck aria-hidden="true" className="size-4 text-state-available-fg" />
          {empty}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
