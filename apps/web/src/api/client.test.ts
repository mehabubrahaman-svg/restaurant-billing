import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, fileNameOf, NetworkError, type RefreshOutcome } from './client';
import { json, problem } from '../test/mock-hub';

/** A zod-like schema without importing zod (the app depends on it only via contracts). */
const Thing = {
  parse(input: unknown): { ok: boolean } {
    const ok = (input as { ok?: unknown } | null)?.ok;
    if (typeof ok !== 'boolean') throw new Error('invalid');
    return { ok };
  },
};

function setup(handler: (token: string | null, url: string, init: RequestInit) => Response) {
  let token: string | null = 'old';
  const refresh = vi.fn(async (): Promise<RefreshOutcome> => {
    await new Promise((r) => setTimeout(r, 5));
    token = 'new';
    return 'ok';
  });
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization');
    return handler(auth === null ? null : auth.replace('Bearer ', ''), String(url), init ?? {});
  });
  const client = new ApiClient(fetchImpl as typeof fetch);
  client.connect({ accessToken: () => token, refresh });
  return { client, refresh, fetchImpl, setToken: (t: string | null) => (token = t) };
}

describe('ApiClient', () => {
  it('sends the bearer token, cookies and JSON body under /api/v1, and validates the reply', async () => {
    const { client, fetchImpl } = setup(() => json({ ok: true }));
    await expect(
      client.json('/things', Thing, { method: 'POST', body: { a: 1 } }),
    ).resolves.toEqual({
      ok: true,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/v1/things');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer old');
    expect(init?.body).toBe('{"a":1}');
  });

  it('omits the token on public endpoints', async () => {
    const { client, fetchImpl } = setup(() => json({ ok: true }));
    await client.json('/auth/login', Thing, { auth: false });
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).has('authorization')).toBe(false);
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const { client, refresh, fetchImpl } = setup((token) =>
      token === 'new' ? json({ ok: true }) : problem(401, 'UNAUTHENTICATED'),
    );
    await expect(client.json('/things', Thing)).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry (no loops)', async () => {
    const { client, fetchImpl } = setup(() => problem(401, 'UNAUTHENTICATED'));
    await expect(client.json('/things', Thing)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not refresh on other 401s such as a wrong PIN', async () => {
    const { client, refresh } = setup(() => problem(401, 'INVALID_CREDENTIALS'));
    await expect(client.json('/auth/approve', Thing)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('turns an unreachable refresh into a NetworkError, keeping the session', async () => {
    const { client, refresh } = setup(() => problem(401, 'UNAUTHENTICATED'));
    refresh.mockResolvedValueOnce('unreachable');
    await expect(client.json('/things', Thing)).rejects.toBeInstanceOf(NetworkError);
  });

  it('parses problem+json, including the permission extension', async () => {
    const { client } = setup(() =>
      problem(403, 'APPROVAL_REQUIRED', { permission: 'billing.discount_override' }),
    );
    const error = await client.json('/things', Thing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: 'APPROVAL_REQUIRED',
      permission: 'billing.discount_override',
    });
  });

  it('reports a malformed success body as BAD_RESPONSE', async () => {
    const { client } = setup(() => json({ nope: 1 }));
    await expect(client.json('/things', Thing)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('wraps fetch failures in NetworkError', async () => {
    const client = new ApiClient((async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    await expect(client.void('/x')).rejects.toBeInstanceOf(NetworkError);
  });

  it('adds the approver token header when given', async () => {
    const { client, fetchImpl } = setup(() => new Response(null, { status: 204 }));
    await client.void('/things', { method: 'POST', approverToken: 'appr-1' });
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('x-approver-token')).toBe(
      'appr-1',
    );
  });
});

describe('files', () => {
  it('downloads a file with the session, keeping the server’s file name', async () => {
    const { client, fetchImpl } = setup(
      () =>
        new Response('a,b\n', {
          headers: { 'content-disposition': 'attachment; filename="day-end-2026-10-28.csv"' },
        }),
    );
    const { blob, fileName } = await client.blob('/reports/day-end.csv', {
      query: { date: '2026-10-28' },
    });
    expect(await blob.text()).toBe('a,b\n');
    expect(fileName).toBe('day-end-2026-10-28.csv');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/v1/reports/day-end.csv?date=2026-10-28');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer old');
  });

  it('uploads a file as is, with extra headers', async () => {
    const { client, fetchImpl } = setup(() => json({ ok: true }, 201));
    const file = new Blob([new Uint8Array([1, 2, 3])]);
    await client.json('/backups/import', Thing, {
      method: 'POST',
      rawBody: file,
      headers: { 'x-backup-passphrase': 'secret words here' },
    });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.body).toBe(file);
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/octet-stream');
    expect(headers.get('x-backup-passphrase')).toBe('secret words here');
  });

  it('reads plain and RFC 5987 file names from Content-Disposition', () => {
    expect(fileNameOf('attachment; filename="a b.csv"')).toBe('a b.csv');
    expect(fileNameOf('attachment; filename=plain.rbak')).toBe('plain.rbak');
    expect(fileNameOf("attachment; filename*=UTF-8''%E0%A4%AC.csv")).toBe('ब.csv');
    expect(fileNameOf('inline')).toBeNull();
    expect(fileNameOf(null)).toBeNull();
  });
});
