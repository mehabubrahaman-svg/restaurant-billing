import type { DiningTable, FloorResponse } from '@restroos/contracts';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints';

export const FLOOR_KEY = ['floor'] as const;
export const qrKey = (tableId: string) => ['floor', 'qr', tableId] as const;

export function useFloor(options: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: FLOOR_KEY,
    queryFn: api.floor.get,
    ...(options.refetchInterval === undefined ? {} : { refetchInterval: options.refetchInterval }),
  });
}

/** Puts tables the Hub returned (after a save or status change) into the cached floor. */
export function mergeTables(client: QueryClient, tables: readonly DiningTable[]): void {
  const byId = new Map(tables.map((t) => [t.id, t]));
  client.setQueryData<FloorResponse>(FLOOR_KEY, (floor) =>
    floor === undefined
      ? floor
      : {
          areas: floor.areas.map((area) => ({
            ...area,
            tables: area.tables.map((t) => byId.get(t.id) ?? t),
          })),
        },
  );
}
