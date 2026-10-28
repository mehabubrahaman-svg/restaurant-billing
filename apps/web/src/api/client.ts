import {
  API_PREFIX,
  APPROVER_HEADER,
  ProblemDetailsSchema,
  type ProblemDetails,
} from '@restroos/contracts';

/** Anything with a zod-style `parse`; keeps this module free of a direct zod dependency. */
export interface Schema<T> {
  parse(input: unknown): T;
}

/** An error response from the Hub (problem+json), or a response we could not understand. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Stable code from the problem body, e.g. VERSION_CONFLICT; BAD_RESPONSE if unparseable. */
    readonly code: string,
    readonly problem: ProblemDetails | null,
    /** For APPROVAL_REQUIRED: the permission the approver must hold. */
    readonly permission: string | null = null,
  ) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status} ${code}`);
    this.name = 'ApiError';
  }
}

/** The Hub could not be reached at all (Wi-Fi down, Hub off, timeout). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The Hub could not be reached', { cause });
    this.name = 'NetworkError';
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

/** Result of trying to renew the access token. */
export type RefreshOutcome = 'ok' | 'invalid' | 'unreachable';

/** How the client reaches the session without importing the auth store (no cycle). */
export interface SessionBridge {
  accessToken(): string | null;
  /** Renews the access token. Concurrent callers share one request. */
  refresh(): Promise<RefreshOutcome>;
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  /** Send the bearer token and recover from 401 by refreshing. Default true. */
  readonly auth?: boolean;
  /** A manager's one-time approval token (see withApproval). */
  readonly approverToken?: string;
  /** Conditional GET: the ETag of the copy we already hold. */
  readonly ifNoneMatch?: string;
  /** Makes a command safe to retry: the Hub answers a replay with the stored response. */
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  /** A file sent as is (`application/octet-stream`) instead of a JSON `body`. */
  readonly rawBody?: Blob;
  /** Extra request headers (e.g. a backup passphrase). */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Header the Hub's idempotency plugin reads (POST and PATCH). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** A fresh Idempotency-Key: 8–128 characters of [A-Za-z0-9_-]; a UUID qualifies. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (e.g. a proxy's HTML error page).
  }
  const parsed = ProblemDetailsSchema.safeParse(body);
  if (!parsed.success) return new ApiError(response.status, 'BAD_RESPONSE', null);
  // `permission` is an extension member, so it is not in the shared schema.
  const raw = body as { permission?: unknown };
  const permission = typeof raw.permission === 'string' ? raw.permission : null;
  return new ApiError(response.status, parsed.data.code, parsed.data, permission);
}

/**
 * Typed fetch wrapper for /api/v1.
 * - Always sends cookies (`credentials: 'include'`): the refresh token is an httpOnly cookie.
 * - The access token lives only in memory and goes in `Authorization`.
 * - On 401 it refreshes once (shared across concurrent requests) and retries once.
 * - Success bodies are validated against the contract schema.
 */
export class ApiClient {
  private bridge: SessionBridge | null = null;

  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  connect(bridge: SessionBridge): void {
    this.bridge = bridge;
  }

  /** Request with a JSON response validated by `schema`. */
  async json<T>(path: string, schema: Schema<T>, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(response.status, 'BAD_RESPONSE', null);
    }
    try {
      return schema.parse(body);
    } catch {
      throw new ApiError(response.status, 'BAD_RESPONSE', null);
    }
  }

  /**
   * Conditional GET. Sends `If-None-Match` when we hold a copy; a 304 comes
   * back as `null` (keep using the cached copy), anything else as the new
   * body with its ETag.
   */
  async cached<T>(
    path: string,
    schema: Schema<T>,
    etag: string | null,
    options: RequestOptions = {},
  ): Promise<{ data: T; etag: string | null } | null> {
    const response = await this.send(path, {
      ...options,
      ...(etag === null ? {} : { ifNoneMatch: etag }),
    });
    if (response.status === 304) return null;
    let body: unknown;
    try {
      body = await response.json();
      return { data: schema.parse(body), etag: response.headers.get('etag') };
    } catch {
      throw new ApiError(response.status, 'BAD_RESPONSE', null);
    }
  }

  /** A file download (CSV, backup): the body as a Blob, with the server's file name. */
  async blob(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ blob: Blob; fileName: string | null }> {
    const response = await this.send(path, options);
    try {
      return {
        blob: await response.blob(),
        fileName: fileNameOf(response.headers.get('content-disposition')),
      };
    } catch {
      throw new ApiError(response.status, 'BAD_RESPONSE', null);
    }
  }

  /** Request whose response body is ignored (204, 202). */
  async void(path: string, options: RequestOptions = {}): Promise<void> {
    await this.send(path, options);
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const auth = options.auth ?? true;
    let response = await this.fetchOnce(path, options, auth);
    if (response.status === 401 && auth && this.bridge !== null) {
      // Only an expired/ended session is worth a refresh. Other 401s (a wrong
      // manager PIN on /auth/approve is INVALID_CREDENTIALS) are real answers.
      const error = await toApiError(response);
      if (error.code !== 'UNAUTHENTICATED' && error.code !== 'BAD_RESPONSE') throw error;
      const outcome = await this.bridge.refresh();
      if (outcome === 'unreachable') throw new NetworkError(null);
      if (outcome === 'invalid') throw error;
      response = await this.fetchOnce(path, options, auth);
    }
    if (!response.ok && !(response.status === 304 && options.ifNoneMatch !== undefined)) {
      throw await toApiError(response);
    }
    return response;
  }

  private async fetchOnce(path: string, options: RequestOptions, auth: boolean) {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.rawBody !== undefined) headers['content-type'] = 'application/octet-stream';
    const token = auth ? (this.bridge?.accessToken() ?? null) : null;
    if (token !== null) headers['authorization'] = `Bearer ${token}`;
    if (options.approverToken !== undefined) headers[APPROVER_HEADER] = options.approverToken;
    if (options.ifNoneMatch !== undefined) headers['if-none-match'] = options.ifNoneMatch;
    if (options.idempotencyKey !== undefined) headers[IDEMPOTENCY_HEADER] = options.idempotencyKey;

    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.rawBody !== undefined ? { body: options.rawBody } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    };
    try {
      return await this.fetchImpl(buildUrl(path, options.query), init);
    } catch (error) {
      if (options.signal?.aborted === true) throw error;
      throw new NetworkError(error);
    }
  }
}

/** `attachment; filename="day-end-2026-10-28.csv"` → `day-end-2026-10-28.csv`. */
export function fileNameOf(disposition: string | null): string | null {
  if (disposition === null) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star !== null) {
    try {
      return decodeURIComponent(star[1]!.trim().replaceAll('"', ''));
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain === null ? null : plain[1]!.trim();
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${API_PREFIX}${path}${qs === '' ? '' : `?${qs}`}`;
}

/** The app's single client. The auth store connects itself on import. */
export const apiClient = new ApiClient();
