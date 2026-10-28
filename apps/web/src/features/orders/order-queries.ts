import type { Kot, Order, OrderSummary, TableOrder } from '@restroos/contracts';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints';
import { FLOOR_KEY } from '../floor/floor-queries';
import type { FloorResponse, OrdersResponse } from '@restroos/contracts';

export const ORDER_KEYS = {
  all: ['orders'],
  open: ['orders', 'open'],
  billed: ['orders', 'billed'],
  detail: (id: string) => ['orders', 'detail', id] as const,
} as const;

export function useOrder(id: string) {
  return useQuery({ queryKey: ORDER_KEYS.detail(id), queryFn: () => api.orders.get(id) });
}

/** Open orders (takeaway and delivery have no table, so the floor lists them from here). */
export function useOpenOrders() {
  return useQuery({ queryKey: ORDER_KEYS.open, queryFn: api.orders.listOpen });
}

/** Billed orders waiting for payment: the POS counter lists them next to the open ones. */
export function useBilledOrders() {
  return useQuery({ queryKey: ORDER_KEYS.billed, queryFn: api.orders.listBilled });
}

/** Statuses for which a table still shows its order on the floor. */
const ON_TABLE: readonly OrderSummary['status'][] = ['OPEN', 'BILLED', 'PENDING_APPROVAL'];

export function toTableOrder(o: OrderSummary): TableOrder {
  return {
    id: o.id,
    orderNo: o.orderNo,
    covers: o.covers,
    subtotal: o.subtotal,
    openedAt: o.openedAt,
    captainId: o.captainId,
    captainName: o.captainName,
    itemCount: o.itemCount,
    pendingCount: o.pendingCount,
    readyCount: o.readyCount,
  };
}

function summaryChanged(cached: OrderSummary, next: OrderSummary): boolean {
  return (
    cached.status !== next.status ||
    cached.subtotal !== next.subtotal ||
    cached.itemCount !== next.itemCount ||
    cached.pendingCount !== next.pendingCount ||
    cached.readyCount !== next.readyCount ||
    cached.tableId !== next.tableId ||
    cached.covers !== next.covers
  );
}

/**
 * Puts the latest summary of an order everywhere it shows: its table on the
 * floor, the open-orders list, and (if loaded) the order itself, which is
 * refetched for its item lines when the summary says something changed.
 */
export function applyOrderSummary(client: QueryClient, summary: OrderSummary): void {
  client.setQueryData<FloorResponse>(FLOOR_KEY, (floor) => {
    if (floor === undefined) return floor;
    const onTable = ON_TABLE.includes(summary.status);
    let changed = false;
    const areas = floor.areas.map((area) => ({
      ...area,
      tables: area.tables.map((table) => {
        if (onTable && table.id === summary.tableId) {
          changed = true;
          return { ...table, currentOrderId: summary.id, openOrder: toTableOrder(summary) };
        }
        // Moved, merged away, paid or cancelled: this table no longer carries it.
        if (table.openOrder?.id === summary.id) {
          changed = true;
          return { ...table, openOrder: null };
        }
        return table;
      }),
    }));
    return changed ? { areas } : floor;
  });

  for (const [key, status] of [
    [ORDER_KEYS.open, 'OPEN'],
    [ORDER_KEYS.billed, 'BILLED'],
  ] as const) {
    client.setQueryData<OrdersResponse>(key, (list) => {
      if (list === undefined) return list;
      const existing = list.data.find((o) => o.id === summary.id);
      if (existing !== undefined && existing.version > summary.version) return list;
      const rest = list.data.filter((o) => o.id !== summary.id);
      return { data: summary.status === status ? [...rest, summary] : rest };
    });
  }

  const detail = client.getQueryData<Order>(ORDER_KEYS.detail(summary.id));
  if (detail === undefined) return;
  if (
    summary.version > detail.version ||
    (summary.version === detail.version && summaryChanged(detail, summary))
  ) {
    client.setQueryData<Order>(ORDER_KEYS.detail(summary.id), { ...detail, ...summary });
    void client.invalidateQueries(
      { queryKey: ORDER_KEYS.detail(summary.id), exact: true },
      { cancelRefetch: false },
    );
  }
}

/** A full order from a command response or a fetch: the newest version wins. */
export function setOrder(client: QueryClient, order: Order): void {
  const held = client.getQueryData<Order>(ORDER_KEYS.detail(order.id));
  if (held === undefined || held.version <= order.version) {
    client.setQueryData(ORDER_KEYS.detail(order.id), order);
  }
  const { items: _items, kots: _kots, ...summary } = order;
  applyOrderSummary(client, summary);
}

/** A KOT moved (or an item on it was bumped): update the order's ticket list and refetch its lines. */
export function applyKotToOrder(
  client: QueryClient,
  kot: Pick<Kot, 'id' | 'orderId' | 'status' | 'readyAt' | 'version'>,
): void {
  const key = ORDER_KEYS.detail(kot.orderId);
  const detail = client.getQueryData<Order>(key);
  if (detail === undefined) return;
  client.setQueryData<Order>(key, {
    ...detail,
    kots: detail.kots.map((k) =>
      k.id === kot.id && k.version <= kot.version
        ? { ...k, status: kot.status, readyAt: kot.readyAt, version: kot.version }
        : k,
    ),
  });
  void client.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
}
