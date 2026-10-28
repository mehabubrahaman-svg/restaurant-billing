import type { OrderSummary } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Badge,
  Bike,
  cn,
  Input,
  Search,
  SegmentedControl,
  ShoppingBag,
  Spinner,
  UtensilsCrossed,
} from '@restroos/ui';
import { useMemo, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '../../features/devices/use-now';
import { useElapsed } from '../../features/orders/elapsed';
import { useBilledOrders, useOpenOrders } from '../../features/orders/order-queries';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';

type Filter = 'ALL' | 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

/** "T5", "Token 12" or "Order #142": how the counter names an order. */
export function useOrderLabel() {
  const { t } = useTranslation();
  return (o: Pick<OrderSummary, 'tableLabel' | 'tokenNo' | 'orderNo'>) =>
    o.tableLabel ??
    (o.tokenNo !== null ? t('order.token', { token: o.tokenNo }) : null) ??
    t('order.number', { orderNo: o.orderNo });
}

const TYPE_ICON = { DINE_IN: UtensilsCrossed, TAKEAWAY: ShoppingBag, DELIVERY: Bike } as const;

/**
 * What can be billed (wireframes §7, left): open orders and billed orders
 * waiting for payment, live. A vertical list on wide counters, a sideways
 * strip on tablets.
 */
export function OrderQueue({
  selectedId,
  onSelect,
  searchRef,
  className,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The search box, focused by F2. */
  searchRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const elapsed = useElapsed();
  const now = useNow(30_000);
  const label = useOrderLabel();
  const open = useOpenOrders();
  const billed = useBilledOrders();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');

  const orders = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Billed orders (waiting for the guest to pay) first, then oldest first.
    return [...(billed.data?.data ?? []), ...(open.data?.data ?? [])]
      .filter((o) => filter === 'ALL' || o.orderType === filter)
      .filter(
        (o) =>
          q === '' ||
          [o.tableLabel ?? '', o.orderNo, o.tokenNo === null ? '' : String(o.tokenNo)].some((s) =>
            s.toLowerCase().includes(q),
          ),
      )
      .sort(
        (a, b) =>
          Number(b.status === 'BILLED') - Number(a.status === 'BILLED') ||
          a.openedAt.localeCompare(b.openedAt),
      );
  }, [open.data, billed.data, filter, query]);

  const error = open.error ?? billed.error;

  return (
    <section
      aria-labelledby="pos-queue-title"
      className={cn('flex min-w-0 flex-col gap-2 rounded-xl border bg-surface p-2', className)}
    >
      <h2 id="pos-queue-title" className="sr-only">
        {t('pos.queue.title')}
      </h2>
      <div className="flex flex-wrap items-center gap-2 xl:flex-col xl:items-stretch">
        <div className="relative min-w-40 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            type="search"
            className="ps-9"
            aria-label={t('pos.queue.search')}
            placeholder={t('pos.queue.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && orders[0] !== undefined) onSelect(orders[0].id);
            }}
          />
        </div>
        <SegmentedControl<Filter>
          size="sm"
          aria-label={t('pos.queue.filter')}
          value={filter}
          onValueChange={setFilter}
          className="flex-wrap"
          options={[
            { value: 'ALL', label: t('pos.queue.all') },
            { value: 'DINE_IN', label: t('pos.queue.dineIn') },
            { value: 'TAKEAWAY', label: t('pos.queue.takeaway') },
            { value: 'DELIVERY', label: t('pos.queue.delivery') },
          ]}
        />
      </div>
      {(open.isPending || billed.isPending) && <Spinner label={t('common.loading')} />}
      {error !== null && (
        <p role="alert" className="text-sm text-state-danger-fg">
          {errorMessage(error)}
        </p>
      )}
      {!open.isPending && !billed.isPending && orders.length === 0 && (
        <p className="p-2 text-sm text-muted-foreground">{t('pos.queue.empty')}</p>
      )}
      <ul
        className="flex gap-2 overflow-x-auto pb-1 xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-x-visible xl:overflow-y-auto xl:pb-0"
        aria-label={t('pos.queue.title')}
      >
        {orders.map((o) => {
          const Icon = TYPE_ICON[o.orderType as keyof typeof TYPE_ICON] ?? ShoppingBag;
          const selected = o.id === selectedId;
          return (
            <li key={o.id} className="shrink-0 xl:shrink">
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(o.id)}
                data-status={o.status}
                className={cn(
                  'flex min-h-touch w-44 flex-col gap-1 rounded-lg border px-3 py-2 text-start xl:w-full',
                  'hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring',
                  selected && 'border-primary bg-accent text-accent-foreground',
                  o.status === 'BILLED' && !selected && 'border-state-billing',
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{label(o)}</span>
                  <span className="tabular-nums">
                    {format.money(Money.ofPaise(o.subtotal), { symbol: true })}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{t('order.number', { orderNo: o.orderNo })}</span>
                  <span className="tabular-nums">{elapsed(o.openedAt, now)}</span>
                  {o.salesChannelName !== null && (
                    <Badge variant="outline" className="text-xs">
                      {t('pos.queue.channel', {
                        channel: o.salesChannelName,
                        id: o.externalOrderId ?? '',
                      })}
                    </Badge>
                  )}
                  {o.status === 'BILLED' && (
                    <Badge variant="info" className="text-xs">
                      {t('pos.queue.billed')}
                    </Badge>
                  )}
                  {o.status === 'OPEN' && o.pendingCount > 0 && (
                    <Badge variant="warning" className="text-xs">
                      {t('pos.queue.unsent', { count: o.pendingCount })}
                    </Badge>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
