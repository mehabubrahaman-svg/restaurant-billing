import { isApiError } from '../api/client';

/**
 * React Query `retry` for screens where a 4xx is a real answer (404 "no QR
 * yet", 403 "not paired"): retry only network trouble and server errors.
 */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}
