import {
  HubToRelaySchema,
  RELAY_HUB_PATH,
  RELAY_SIGNATURE_HEADER,
  RelayWebhookSchema,
  type RelayToHub,
} from '@restroos/contracts';
import Fastify from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RelayStore } from './store';

export interface RelayOptions {
  store: RelayStore;
  /** Fastify's logger option, e.g. `{ level: 'info' }`. */
  logger?: boolean | { level: string };
  now?: () => Date;
  /** For tests: where middleware calls go. */
  fetch?: typeof fetch;
}

/** A middleware call that failed is tried again after this, doubling, up to an hour. */
const FIRST_RETRY_MS = 5_000;
const MAX_ATTEMPTS = 12;

export function signature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function sameSignature(expected: string, given: string | undefined): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The relay: the middleware posts orders here (signed), the Hub holds a
 * WebSocket open to it from the restaurant, and what the Hub sends back
 * (menu, availability, order status) is forwarded to the middleware. Every
 * message is stored first, so nothing is lost while either side is away.
 */
export function buildRelay(options: RelayOptions) {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  const doFetch = options.fetch ?? fetch;
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024 });
  const hubs = new Map<string, WebSocket>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  // Keep the raw body: the signature is over the exact bytes sent.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  );

  const send = (ws: WebSocket, message: RelayToHub) => ws.send(JSON.stringify(message));
  /** On (re)connect every unacknowledged webhook goes again; a new one goes on its own. */
  const deliver = (hubId: string, onlyId?: string) => {
    const ws = hubs.get(hubId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const m of store.pendingFor(hubId)) {
      if (onlyId !== undefined && m.id !== onlyId) continue;
      send(ws, { type: 'deliver', id: m.id, message: JSON.parse(m.body) });
      store.markDelivered(m.id, now());
    }
  };

  app.get('/health', async () => ({ ok: true, hubsConnected: hubs.size }));

  app.post('/webhooks/:hubId', async (request, reply) => {
    const { hubId } = request.params as { hubId: string };
    const hub = store.hub(hubId);
    const raw = typeof request.body === 'string' ? request.body : '';
    if (!hub) return reply.status(404).send({ error: 'unknown hub' });
    const given = request.headers[RELAY_SIGNATURE_HEADER];
    if (
      !sameSignature(
        signature(hub.webhookSecret, raw),
        typeof given === 'string' ? given : undefined,
      )
    ) {
      return reply.status(401).send({ error: 'bad signature' });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply.status(400).send({ error: 'not JSON' });
    }
    const message = RelayWebhookSchema.safeParse(parsed);
    if (!message.success) {
      return reply
        .status(422)
        .send({ error: 'not a relay webhook', issues: message.error.issues.slice(0, 10) });
    }
    const { event, order } = message.data;
    const stored = store.receive(
      hubId,
      event,
      `${event}:${order.channel}:${order.externalOrderId}`,
      JSON.stringify(message.data),
      now(),
    );
    deliver(hubId, stored.id);
    return reply.status(202).send({ id: stored.id, status: stored.status });
  });

  wss.on('connection', (ws: WebSocket, hubId: string) => {
    hubs.get(hubId)?.close(4409, 'replaced by a newer connection');
    hubs.set(hubId, ws);
    ws.on('close', () => {
      if (hubs.get(hubId) === ws) hubs.delete(hubId);
    });
    ws.on('message', (data) => {
      let message;
      try {
        message = HubToRelaySchema.parse(JSON.parse(String(data)));
      } catch {
        ws.close(4400, 'bad message');
        return;
      }
      if (message.type === 'ack') {
        store.acknowledge(hubId, message.id, message.ok, message.error ?? null, now());
      } else {
        store.queue(
          hubId,
          message.id,
          message.kind,
          JSON.stringify(message.payload ?? null),
          now(),
        );
        send(ws, { type: 'stored', id: message.id });
        void forwardDue();
      }
    });
    deliver(hubId);
  });

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://relay');
    const hubId = url.searchParams.get('hub') ?? '';
    const key = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    const hub = url.pathname === RELAY_HUB_PATH ? store.hub(hubId) : undefined;
    if (!hub || key === undefined || !store.checkKey(hub, key)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, hub.id));
  };
  app.server.on('upgrade', onUpgrade);

  let forwarding: Promise<number> | null = null;
  /** Sends what is due to each Hub's middleware; returns how many went. */
  function forwardDue(): Promise<number> {
    forwarding ??= (async () => {
      let sent = 0;
      try {
        for (const m of store.due(now())) {
          const hub = store.hub(m.hubId);
          const retry = (error: string) => {
            const attempts = m.attempts + 1;
            const next =
              attempts >= MAX_ATTEMPTS
                ? null
                : new Date(now().getTime() + Math.min(FIRST_RETRY_MS * 2 ** m.attempts, 3_600_000));
            store.markFailedAttempt(m.id, error, next);
          };
          if (!hub?.middlewareUrl) {
            retry('no middleware is set for this hub');
            continue;
          }
          try {
            const response = await doFetch(`${hub.middlewareUrl.replace(/\/$/, '')}/${m.kind}`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-relay-hub': hub.id,
                'idempotency-key': m.id,
                ...(hub.middlewareKey ? { authorization: `Bearer ${hub.middlewareKey}` } : {}),
              },
              body: m.body,
              signal: AbortSignal.timeout(15_000),
            });
            if (response.ok) {
              store.markSent(m.id, now());
              sent += 1;
            } else {
              retry(`middleware answered ${response.status}`);
            }
          } catch (error) {
            retry(error instanceof Error ? error.message : String(error));
          }
        }
      } finally {
        forwarding = null;
      }
      return sent;
    })();
    return forwarding;
  }

  const timer = setInterval(() => void forwardDue(), 2_000);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    app.server.off('upgrade', onUpgrade);
    for (const ws of hubs.values()) ws.close(1001, 'relay stopping');
    wss.close();
  });

  return { app, forwardDue, connected: (hubId: string) => hubs.has(hubId) };
}
