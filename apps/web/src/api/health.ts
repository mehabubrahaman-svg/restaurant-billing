/** Hub liveness endpoint (apps/server). Any 2xx counts as reachable. */
export const HEALTH_PATH = '/api/v1/health';
export const HEALTH_POLL_MS = 5_000;
/** Below the poll interval, so a hung request never overlaps the next poll. */
export const HEALTH_TIMEOUT_MS = 3_000;

export async function checkHealth(signal: AbortSignal): Promise<void> {
  const response = await fetch(HEALTH_PATH, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(HEALTH_TIMEOUT_MS)]),
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Hub health check failed: HTTP ${response.status}`);
}
