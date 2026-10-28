import type { Reservation } from '@restroos/contracts';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints';
import { FLOOR_KEY } from './floor-queries';

export const RESERVATIONS_KEY = ['reservations'] as const;

/** From 3 hours ago to 30 days ahead (the Hub's default), every status. */
export function useReservations(enabled = true) {
  return useQuery({
    queryKey: RESERVATIONS_KEY,
    queryFn: () => api.reservations.list(),
    refetchInterval: 60_000,
    enabled,
  });
}

/** After a booking changes: the list, and the floor tiles that show the next booking. */
export function refreshReservations(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: RESERVATIONS_KEY });
  void client.invalidateQueries({ queryKey: FLOOR_KEY });
}

/** The device's calendar day of an ISO instant (the tablet is in the restaurant's time zone). */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bookings still to come, grouped by local day, in time order. */
export function upcomingByDay(reservations: readonly Reservation[]) {
  const days = new Map<string, Reservation[]>();
  for (const r of [...reservations].sort((a, b) => a.reservedFor.localeCompare(b.reservedFor))) {
    const day = localDay(r.reservedFor);
    days.set(day, [...(days.get(day) ?? []), r]);
  }
  return [...days.entries()].map(([day, list]) => ({ day, reservations: list }));
}
