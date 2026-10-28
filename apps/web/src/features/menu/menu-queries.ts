import type { MenuSnapshot } from '@restroos/contracts';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints';

export const MENU_KEYS = {
  all: ['menu'],
  stations: ['menu', 'stations'],
  categories: ['menu', 'categories'],
  addonGroups: ['menu', 'addon-groups'],
  items: ['menu', 'items'],
  snapshot: ['menu', 'snapshot'],
} as const;

export const useStations = () =>
  useQuery({ queryKey: MENU_KEYS.stations, queryFn: api.menu.stations });
export const useCategories = () =>
  useQuery({ queryKey: MENU_KEYS.categories, queryFn: api.menu.categories });
export const useAddonGroups = () =>
  useQuery({ queryKey: MENU_KEYS.addonGroups, queryFn: api.menu.addonGroups });
export const useMenuItems = () => useQuery({ queryKey: MENU_KEYS.items, queryFn: api.menu.items });

/** Any menu change: editor lists and the ordering snapshot are refetched. */
export function invalidateMenu(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: MENU_KEYS.all });
}

/** The snapshot we hold, with the ETag it came with. */
export interface CachedSnapshot {
  readonly snapshot: MenuSnapshot;
  readonly etag: string | null;
}

/**
 * The active menu as ordering devices cache it (GET /menu). Refetches send
 * `If-None-Match`, so an unchanged menu costs a 304 and no download. Kept
 * for the whole session (gcTime ∞): captains and the kitchen read it often.
 */
export function useMenuSnapshot() {
  const client = useQueryClient();
  return useQuery({
    queryKey: MENU_KEYS.snapshot,
    queryFn: async (): Promise<CachedSnapshot> => {
      const held = client.getQueryData<CachedSnapshot>(MENU_KEYS.snapshot);
      const fresh = await api.menu.snapshot(held?.etag ?? null);
      if (fresh === null && held !== undefined) return held;
      if (fresh === null) return { snapshot: await refetchWhole(), etag: null };
      return { snapshot: fresh.data, etag: fresh.etag };
    },
    staleTime: 60_000,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** A 304 without a copy to keep (cache evicted mid-flight): ask again unconditionally. */
async function refetchWhole(): Promise<MenuSnapshot> {
  const again = await api.menu.snapshot(null);
  if (again === null) throw new Error('The Hub answered 304 to an unconditional request');
  return again.data;
}
