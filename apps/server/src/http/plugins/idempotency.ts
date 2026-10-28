import type { IdempotencyStore } from '@restroos/application';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpProblem } from '../problem';

declare module 'fastify' {
  interface FastifyRequest {
    idempotency?: { scope: string; key: string; requestHash: string };
  }
}

const HEADER = 'idempotency-key';
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const NOT_STORED = new Set([401, 403, 429]);

/**
 * Makes POST and PATCH commands safe to retry. A tablet that lost Wi-Fi replays its
 * queued commands with the same Idempotency-Key; we return the stored response
 * instead of creating a second order or a second payment.
 *
 * Keys are scoped to the signed-in user (or the device before sign-in) so two
 * users or devices can never collide. Reusing a key with a different body is rejected.
 */
export const idempotencyPlugin = fp<{ store: IdempotencyStore }>(
  async (app: FastifyInstance, { store }) => {
    const inFlight = new Set<string>();

    app.addHook('preHandler', async (request, reply) => {
      const key = request.headers[HEADER];
      if ((request.method !== 'POST' && request.method !== 'PATCH') || typeof key !== 'string')
        return;
      if (!KEY_RE.test(key)) {
        throw new HttpProblem(
          'VALIDATION_FAILED',
          'Idempotency-Key must be 8-128 characters of [A-Za-z0-9_-]',
        );
      }
      const scope = scopeOf(request);
      const requestHash = hashRequest(request);
      const stored = store.find(scope, key);
      if (stored) {
        if (stored.requestHash !== requestHash) {
          throw new HttpProblem(
            'IDEMPOTENCY_KEY_REUSED',
            'this Idempotency-Key was used for a different request',
          );
        }
        return reply
          .status(stored.statusCode)
          .header('idempotent-replayed', 'true')
          .type('application/json')
          .send(stored.body);
      }
      const lockKey = `${scope}\u0000${key}`;
      if (inFlight.has(lockKey)) {
        throw new HttpProblem(
          'IDEMPOTENCY_IN_PROGRESS',
          'a request with this Idempotency-Key is still running',
        );
      }
      inFlight.add(lockKey);
      request.idempotency = { scope, key, requestHash };
    });

    app.addHook('onSend', async (request, reply, payload) => {
      const ctx = request.idempotency;
      if (!ctx || reply.getHeader('idempotent-replayed')) return payload;
      // Not remembered: server errors, and refusals the client fixes by retrying the same
      // request (signing in again, adding a manager's X-Approver-Token, waiting out a rate limit).
      if (
        !NOT_STORED.has(reply.statusCode) &&
        reply.statusCode < 500 &&
        typeof payload === 'string'
      ) {
        store.save(ctx.scope, ctx.key, {
          requestHash: ctx.requestHash,
          statusCode: reply.statusCode,
          body: payload,
        });
      }
      return payload;
    });

    app.addHook('onResponse', async (request) => {
      const ctx = request.idempotency;
      if (ctx) inFlight.delete(`${ctx.scope}\u0000${ctx.key}`);
    });
  },
  { name: 'idempotency' },
);

function scopeOf(request: FastifyRequest): string {
  if (request.principal) return `user:${request.principal.userId}`;
  const device = request.headers['x-device-id'];
  return typeof device === 'string' && device.length > 0 ? `device:${device}` : `ip:${request.ip}`;
}

function hashRequest(request: FastifyRequest): string {
  return createHash('sha256')
    .update(request.method)
    .update('\n')
    .update(request.url)
    .update('\n')
    .update(JSON.stringify(request.body ?? null))
    .digest('hex');
}
