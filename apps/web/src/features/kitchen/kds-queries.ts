import type { Kot, KotsResponse } from '@restroos/contracts';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints';

export const KITCHEN_KEYS = {
  all: ['kitchen'],
  kotLists: ['kitchen', 'kots'],
  kots: (stationId: string | null) => ['kitchen', 'kots', stationId ?? 'all'] as const,
  metrics: ['kitchen', 'metrics'],
  chefs: ['kitchen', 'chefs'],
} as const;

/** The KDS board polls slowly as a safety net; WebSocket messages keep it current. */
export const KOTS_REFETCH_MS = 60_000;
export const METRICS_REFETCH_MS = 30_000;

export function useKots(stationId: string | null) {
  return useQuery({
    queryKey: KITCHEN_KEYS.kots(stationId),
    queryFn: () => api.kitchen.kots(stationId),
    refetchInterval: KOTS_REFETCH_MS,
  });
}

export function useKitchenMetrics() {
  return useQuery({
    queryKey: KITCHEN_KEYS.metrics,
    queryFn: api.kitchen.metrics,
    refetchInterval: METRICS_REFETCH_MS,
  });
}

export function useChefs(enabled: boolean) {
  return useQuery({
    queryKey: KITCHEN_KEYS.chefs,
    queryFn: api.kitchen.chefs,
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Statuses the board shows; SERVED and CANCELLED tickets leave it. */
export const ACTIVE_KOT_STATUSES: readonly Kot['status'][] = [
  'NEW',
  'ACCEPTED',
  'COOKING',
  'READY',
];

/**
 * Puts the latest state of a KOT into every cached board (all stations, or
 * its own station), adding, replacing (newer version only) or removing it.
 */
export function applyKot(client: QueryClient, kot: Kot): void {
  const active = ACTIVE_KOT_STATUSES.includes(kot.status);
  for (const [key, data] of client.getQueriesData<KotsResponse>({
    queryKey: KITCHEN_KEYS.kotLists,
  })) {
    if (data === undefined) continue;
    const station = key[2];
    const matches = station === 'all' || station === kot.kitchenStationId;
    const existing = data.data.find((k) => k.id === kot.id);
    if (existing !== undefined && existing.version > kot.version) continue;
    const rest = data.data.filter((k) => k.id !== kot.id);
    if (active && matches) client.setQueryData(key, { data: [...rest, kot] });
    else if (existing !== undefined) client.setQueryData(key, { data: rest });
  }
}
