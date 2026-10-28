import type { InventoryItem, StockAlerts, StockCount } from '@restroos/contracts';
import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import { api, type StockMovementsFilter } from '../../api/endpoints';
import { usePermission } from '../auth/permissions';
import { REPORT_KEYS } from '../reports/report-queries';

export const INVENTORY_KEYS = {
  all: ['inventory'],
  units: ['inventory', 'units'],
  items: (includeRetired: boolean) => ['inventory', 'items', includeRetired] as const,
  item: (id: string) => ['inventory', 'item', id] as const,
  movements: (filter: StockMovementsFilter) => ['inventory', 'movements', filter] as const,
  alerts: ['inventory', 'alerts'],
  counts: ['inventory', 'counts'],
  count: (id: string) => ['inventory', 'count', id] as const,
  recipes: (menuItemId: string) => ['inventory', 'recipes', menuItemId] as const,
  addonIngredients: (addonId: string) => ['inventory', 'addon-ingredients', addonId] as const,
  consumption: (from: string, to: string) => ['inventory', 'consumption', from, to] as const,
} as const;

/** Movements per page of an item's history. */
export const MOVEMENTS_PAGE = 50;

/** g, kg, ml, l, pc, dozen, tray: seeded reference data that rarely changes. */
export const useUnits = () =>
  useQuery({ queryKey: INVENTORY_KEYS.units, queryFn: api.inventory.units, staleTime: Infinity });

/** `enabled: false` for screens that only use the list to show translated names. */
export const useInventoryItems = (includeRetired = false, enabled = true) =>
  useQuery({
    queryKey: INVENTORY_KEYS.items(includeRetired),
    queryFn: () => api.inventory.items(includeRetired),
    enabled,
  });

/** May read the item list (the store room, and the menu editor for recipes). */
export const ITEM_LIST_PERMISSIONS = ['inventory.view', 'menu.manage'] as const;

export const useInventoryItem = (id: string) =>
  useQuery({ queryKey: INVENTORY_KEYS.item(id), queryFn: () => api.inventory.item(id) });

/** One item's (or every item's) movements, newest first, a page at a time. */
export function useMovements(filter: Omit<StockMovementsFilter, 'before' | 'limit'>) {
  return useInfiniteQuery({
    queryKey: INVENTORY_KEYS.movements(filter),
    queryFn: ({ pageParam }) =>
      api.inventory.movements({
        ...filter,
        limit: MOVEMENTS_PAGE,
        ...(pageParam === null ? {} : { before: pageParam }),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Low, out and over stock, negative balances and batches about to expire; every minute. */
export const useStockAlerts = (enabled = true) =>
  useQuery({
    queryKey: INVENTORY_KEYS.alerts,
    queryFn: api.inventory.alerts,
    refetchInterval: 60_000,
    enabled,
  });

/**
 * The Hub's business day, which runs past midnight until the day start (04:00
 * by default), so the device's calendar date can be a day ahead. Read from
 * the stock alerts, or the owner's dashboard for report-only users. `settled`
 * once known, or once neither can tell (the caller falls back to the device date).
 */
export function useBusinessDate(): { date: string | undefined; settled: boolean } {
  const canStock = usePermission('inventory.view');
  const canSales = usePermission('reports.sales');
  const alerts = useStockAlerts(canStock);
  const dashboard = useQuery({
    queryKey: REPORT_KEYS.dashboard,
    queryFn: api.reports.dashboard,
    enabled: !canStock && canSales,
  });
  const date = alerts.data?.businessDate ?? dashboard.data?.businessDate;
  return {
    date,
    settled: date !== undefined || alerts.isError || dashboard.isError || (!canStock && !canSales),
  };
}

/** What needs doing: items out or low, and batches expiring (over-stock can wait). */
export function alertCount(alerts: StockAlerts): number {
  return alerts.levels.filter((l) => l.level !== 'OVER').length + alerts.expiring.length;
}

export const useStockCounts = () =>
  useQuery({ queryKey: INVENTORY_KEYS.counts, queryFn: api.inventory.counts });

export const useStockCount = (id: string) =>
  useQuery({ queryKey: INVENTORY_KEYS.count(id), queryFn: () => api.inventory.count(id) });

export const useRecipes = (menuItemId: string) =>
  useQuery({
    queryKey: INVENTORY_KEYS.recipes(menuItemId),
    queryFn: () => api.inventory.recipes(menuItemId),
  });

export const useAddonIngredients = (addonId: string) =>
  useQuery({
    queryKey: INVENTORY_KEYS.addonIngredients(addonId),
    queryFn: () => api.inventory.addonIngredients(addonId),
  });

export const useConsumption = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: INVENTORY_KEYS.consumption(from, to),
    queryFn: () => api.reports.consumption(from, to),
    enabled,
  });

/** After any stock change: balances, alerts, counts and reports are refetched. */
export function invalidateStock(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: INVENTORY_KEYS.all });
}

/** Puts a count the Hub just returned into the cache, and refreshes everything it affects. */
export function storeCount(client: QueryClient, count: StockCount): void {
  client.setQueryData(INVENTORY_KEYS.count(count.id), count);
  void client.invalidateQueries({ queryKey: INVENTORY_KEYS.counts });
}

/** Items by id, for joining lines (counts, recipes) with today's average cost. */
export function itemsById(items: readonly InventoryItem[]): ReadonlyMap<string, InventoryItem> {
  return new Map(items.map((i) => [i.id, i]));
}
