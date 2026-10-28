export interface StoredResponse {
  readonly requestHash: string;
  readonly statusCode: number;
  readonly body: string;
}

/**
 * Remembers the response to each `Idempotency-Key` so a retried command (a
 * tablet replaying its offline queue, a double tap) returns the original
 * result instead of running twice.
 */
export interface IdempotencyStore {
  find(scope: string, key: string): StoredResponse | undefined;
  save(scope: string, key: string, response: StoredResponse): void;
  /** Forgets keys older than the retention window. Returns how many were removed. */
  purgeExpired(): number;
}
