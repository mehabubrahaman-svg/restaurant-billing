import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/endpoints';

export const QR_REQUESTS_KEY = ['qr-requests'] as const;

/** Guests' QR orders and calls waiting for a captain; live updates refetch it. */
export function useQrRequests(enabled = true) {
  return useQuery({
    queryKey: QR_REQUESTS_KEY,
    queryFn: api.qrRequests.list,
    enabled,
    // A safety net: `floor.qr_requests.changed` keeps it current.
    refetchInterval: 60_000,
  });
}
