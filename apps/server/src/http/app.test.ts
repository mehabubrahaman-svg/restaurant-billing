import { HealthResponseSchema, ProblemDetailsSchema } from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestServer, type TestServer } from '../testing/test-server';
import { HttpProblem } from './problem';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('GET /api/v1/health', () => {
  it('reports the database and schema version', async () => {
    server = await createTestServer();
    const res = await server.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponseSchema.parse(res.json());
    expect(body).toMatchObject({
      status: 'ok',
      database: { ok: true },
      serverTime: '2026-10-28T12:00:00.000Z',
    });
    expect(body.database.schemaVersion).toBeGreaterThanOrEqual(4);
  });

  it('echoes a request id', async () => {
    server = await createTestServer();
    const res = await server.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('errors as problem+json', () => {
  async function serverWithFailingRoutes() {
    return createTestServer({
      registerApiRoutes: (api) => {
        api.get('/boom/domain', { config: { public: true } }, async () => {
          throw new DomainError('VERSION_CONFLICT', 'order changed meanwhile');
        });
        api.get('/boom/rule', { config: { public: true } }, async () => {
          throw new DomainError('TABLE_NOT_AVAILABLE', 'T4 is being cleaned');
        });
        api.get('/boom/http', { config: { public: true } }, async () => {
          throw new HttpProblem('FORBIDDEN', 'needs billing.refund');
        });
        api.get('/boom/crash', { config: { public: true } }, async () => {
          throw new Error('secret internal detail');
        });
        api.post('/boom/validate', { config: { public: true } }, async (request) => {
          z.object({ quantity: z.number().int().positive() }).parse(request.body);
          return {};
        });
      },
    });
  }

  it.each([
    ['/api/v1/boom/domain', 409, 'VERSION_CONFLICT'],
    ['/api/v1/boom/rule', 422, 'TABLE_NOT_AVAILABLE'],
    ['/api/v1/boom/http', 403, 'FORBIDDEN'],
    ['/api/v1/nope', 404, 'NOT_FOUND'],
  ])('%s → %i %s', async (url, status, code) => {
    server = await serverWithFailingRoutes();
    const res = await server.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(status);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(ProblemDetailsSchema.parse(res.json())).toMatchObject({ status, code });
  });

  it('hides internal error details', async () => {
    server = await serverWithFailingRoutes();
    const res = await server.app.inject({ method: 'GET', url: '/api/v1/boom/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret internal detail');
    expect(res.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('reports each validation issue', async () => {
    server = await serverWithFailingRoutes();
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/v1/boom/validate',
      payload: { quantity: -1 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ path: 'quantity' }] });
  });

  it('turns malformed JSON into a 400 problem', async () => {
    server = await serverWithFailingRoutes();
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/v1/boom/validate',
      headers: { 'content-type': 'application/json' },
      payload: '{"quantity":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('Idempotency-Key', () => {
  async function serverWithCounter() {
    let created = 0;
    const s = await createTestServer({
      registerApiRoutes: (api) => {
        api.post('/test-orders', { config: { public: true } }, async (_request, reply) => {
          created += 1;
          return reply.status(201).send({ orderNo: created });
        });
      },
    });
    return { s, created: () => created };
  }
  const post = (s: TestServer, key: string | undefined, body: object, device = 'tab-1') =>
    s.app.inject({
      method: 'POST',
      url: '/api/v1/test-orders',
      headers: { 'x-device-id': device, ...(key && { 'idempotency-key': key }) },
      payload: body,
    });

  it('replays the stored response instead of running the command twice', async () => {
    const { s, created } = await serverWithCounter();
    server = s;
    const first = await post(s, 'offline-cmd-0001', { table: 'T2' });
    const retry = await post(s, 'offline-cmd-0001', { table: 'T2' });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(created()).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const { s } = await serverWithCounter();
    server = s;
    await post(s, 'offline-cmd-0002', { table: 'T2' });
    const res = await post(s, 'offline-cmd-0002', { table: 'T3' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('scopes keys per device', async () => {
    const { s, created } = await serverWithCounter();
    server = s;
    await post(s, 'same-key-0003', { table: 'T2' }, 'tab-1');
    await post(s, 'same-key-0003', { table: 'T2' }, 'tab-2');
    expect(created()).toBe(2);
  });

  it('runs every request when no key is sent', async () => {
    const { s, created } = await serverWithCounter();
    server = s;
    await post(s, undefined, { table: 'T2' });
    await post(s, undefined, { table: 'T2' });
    expect(created()).toBe(2);
  });

  it('rejects a malformed key', async () => {
    const { s } = await serverWithCounter();
    server = s;
    const res = await post(s, 'bad key!', { table: 'T2' });
    expect(res.statusCode).toBe(422);
  });
});

describe('rate limiting', () => {
  it('answers 429 as problem+json', async () => {
    server = await createTestServer({ config: { rateLimitPerMinute: 2 } });
    const hit = () =>
      server!.app.inject({ method: 'GET', url: '/api/v1/health', remoteAddress: '192.168.1.50' });
    await hit();
    await hit();
    const res = await hit();
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('serving the web app', () => {
  it('serves index.html for client routes and keeps API 404s as JSON', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'restroos-web-'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>RestroOS</title>');
    try {
      server = await createTestServer({ config: { webDist: webDir } });
      const page = await server.app.inject({ method: 'GET', url: '/pos' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>RestroOS</title>');
      const api = await server.app.inject({ method: 'GET', url: '/api/v1/nope' });
      expect(api.statusCode).toBe(404);
      expect(api.json()).toMatchObject({ code: 'NOT_FOUND' });

      // A rebuilt web app is served without restarting the Hub; a stale asset is a 404, not HTML.
      mkdirSync(join(webDir, 'assets'));
      writeFileSync(join(webDir, 'assets', 'index-new.js'), 'console.log(1)');
      const fresh = await server.app.inject({ method: 'GET', url: '/assets/index-new.js' });
      expect(fresh.statusCode).toBe(200);
      expect(fresh.headers['content-type']).toContain('javascript');
      const gone = await server.app.inject({ method: 'GET', url: '/assets/index-old.js' });
      expect(gone.statusCode).toBe(404);
    } finally {
      rmSync(webDir, { recursive: true, force: true });
    }
  });
});

describe('JSON bodies', () => {
  it('treats an empty JSON body as no body, and rejects broken JSON', async () => {
    server = await createTestServer({
      registerApiRoutes: (api) => {
        api.post('/echo', { config: { public: true } }, async (request) => ({ body: request.body ?? null }));
      },
    });
    const empty = await server.app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(empty.json()).toEqual({ body: null });
    const broken = await server.app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":',
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json().code).toBe('VALIDATION_FAILED');
  });
});
