import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { checkHealth, HEALTH_POLL_MS } from '../../api/health';
import { useConnectionStore } from './connection-store';

export const HEALTH_QUERY_KEY = ['hub', 'health'] as const;

/**
 * Keeps the connection store current. Mount once, near the root.
 * - Browser `online`/`offline` events flip state immediately.
 * - The Hub's /health endpoint is polled every 5 s, even in the background
 *   and while the browser claims to be offline (LAN-only setups often report
 *   "offline" because there is no internet, yet the Hub is reachable).
 */
export function useConnectionMonitor(): void {
  const setBrowserOnline = useConnectionStore((s) => s.setBrowserOnline);
  const reportSuccess = useConnectionStore((s) => s.reportSuccess);
  const reportFailure = useConnectionStore((s) => s.reportFailure);

  useEffect(() => {
    const online = () => setBrowserOnline(true);
    const offline = () => setBrowserOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    setBrowserOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [setBrowserOnline]);

  useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: async ({ signal }) => {
      try {
        await checkHealth(signal);
      } catch (error) {
        // Cancelled by React Query (unmount, refetch): says nothing about the Hub.
        if (!signal.aborted) reportFailure();
        throw error;
      }
      reportSuccess();
      return Date.now();
    },
    refetchInterval: HEALTH_POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    networkMode: 'always',
  });
}
