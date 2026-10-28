import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/endpoints';

export const SALES_CHANNELS_KEY = ['sales-channels'] as const;

/** Direct sales plus every aggregator (Swiggy, Zomato…) and own online shop. */
export function useSalesChannels(enabled = true) {
  return useQuery({
    queryKey: SALES_CHANNELS_KEY,
    queryFn: api.salesChannels.list,
    staleTime: 60_000,
    enabled,
  });
}
