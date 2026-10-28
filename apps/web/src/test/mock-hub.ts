import { vi } from 'vitest';

export type Handler = (request: {
  body: unknown;
  headers: Headers;
  url: URL;
}) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json({ type: 'about:blank', title: code, status, code, ...extra }, status);

/**
 * Stubs global fetch with a tiny Hub: routes are "METHOD /path" (without
 * /api/v1). Unmatched requests answer 404 so a missing stub is obvious.
 * Returns the mock so tests can inspect calls.
 */
export function mockHub(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://hub.test');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) return problem(404, 'NOT_FOUND', { detail: `${method} ${path}` });
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    return handler({ body, headers: new Headers(init?.headers), url });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The routes every app render needs: health, set-up Hub, no session. */
export const BASE_ROUTES: Record<string, Handler> = {
  'GET /health': () => json({}),
  'GET /setup/status': () => json({ needsSetup: false, states: [] }),
  'POST /auth/refresh': () => problem(401, 'UNAUTHENTICATED'),
  'GET /auth/pin-users': () => json({ data: [] }),
  // The captain's floor counts today's bookings.
  'GET /reservations': () => json({ data: [] }),
};
