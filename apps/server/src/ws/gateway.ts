import type { Principal } from '@restroos/application';
import {
  ClientMessageSchema,
  DEVICE_TOKEN_HEADER,
  WS_CLOSE_UNAUTHENTICATED,
  WS_PATH,
  type ServerControl,
  type ServerMessage,
  type WsTopic,
} from '@restroos/contracts';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import type { Logger } from 'pino';
import { WebSocket, WebSocketServer } from 'ws';
import type { Cradle } from '../container';
import { DEVICE_COOKIE } from '../http/plugins/device';
import { dedupe, messagesFor, type EventRef, type Outgoing } from './live-messages';

const AUTH_TIMEOUT_MS = 5_000;
const REVALIDATE_MS = 60_000;
const HEARTBEAT_MS = 30_000;
const DELAY_SCAN_MS = 15_000;
/** Beyond this many events, a reconnecting client refetches instead of replaying. */
const MAX_REPLAY = 2_000;
/** A client this far behind is dropped; it reconnects and resumes. */
const MAX_BUFFERED_BYTES = 1_000_000;

interface Client {
  readonly ws: WebSocket;
  readonly device: { id: string; branchId: string; kind: string } | null;
  token: string | null;
  principal: Principal | null;
  branchId: string | null;
  topics: Set<WsTopic>;
  authenticated: boolean;
  alive: boolean;
}

/**
 * Live updates over WebSocket (docs/09 WP 4.3, docs/05 §5). Committed domain
 * events become messages with the entity's current state; each connection
 * receives the topics its permissions allow. Attached to both the HTTP and the
 * HTTPS listener.
 */
export class WsGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private readonly clients = new Set<Client>();
  private pending: Outgoing[] = [];
  private flushScheduled = false;
  private readonly delayed = new Set<string>();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly unsubscribe: () => void;

  constructor(
    private readonly cradle: Cradle,
    private readonly logger: Logger,
  ) {
    this.unsubscribe = cradle.eventBus.subscribe('*', (event) => this.onEvent(event));
    this.timers.push(
      setInterval(() => this.heartbeat(), HEARTBEAT_MS),
      setInterval(() => void this.revalidate(), REVALIDATE_MS),
      setInterval(() => this.scanDelays(), DELAY_SCAN_MS),
    );
    for (const t of this.timers) t.unref();
  }

  attach(server: HttpServer | HttpsServer): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== WS_PATH) return; // not ours: leave it for anything else listening
      this.wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws, req));
    });
  }

  /** Connected clients, for tests and the health page. */
  get size(): number {
    return this.clients.size;
  }

  close(): void {
    this.unsubscribe();
    for (const t of this.timers) clearInterval(t);
    for (const c of this.clients) c.ws.close(1001, 'server shutting down');
    this.wss.close();
  }

  /** Checks overdue KOTs now (normally every 15 s). */
  scanDelays(): void {
    const now = this.cradle.clock.now();
    const overdue = this.cradle.kitchenQueries.overdue(null, now);
    const still = new Set(overdue.map((k) => k.id));
    for (const id of this.delayed) if (!still.has(id)) this.delayed.delete(id);
    const seq = this.latestSeq();
    for (const kot of overdue) {
      if (this.delayed.has(kot.id)) continue;
      this.delayed.add(kot.id);
      this.broadcast({
        key: `delay:${kot.id}`,
        topics: ['kitchen'],
        message: {
          type: 'kitchen.kot.delayed',
          seq,
          branchId: kot.branchId,
          occurredAt: now.toISOString(),
          data: {
            kotId: kot.id,
            overdueSeconds: Math.round((now.getTime() - kot.targetReadyAt.getTime()) / 1000),
          },
        },
      });
    }
  }

  // ---- connections --------------------------------------------------------------------------
  private connect(ws: WebSocket, req: IncomingMessage): void {
    const client: Client = {
      ws,
      device: this.deviceOf(req),
      token: null,
      principal: null,
      branchId: null,
      topics: new Set(),
      authenticated: false,
      alive: true,
    };
    this.clients.add(client);
    const authTimer = setTimeout(() => {
      if (!client.authenticated) ws.close(WS_CLOSE_UNAUTHENTICATED, 'send auth first');
    }, AUTH_TIMEOUT_MS);
    ws.on('pong', () => (client.alive = true));
    ws.on('close', () => {
      clearTimeout(authTimer);
      this.clients.delete(client);
    });
    ws.on('error', (error) => this.logger.debug({ err: error }, 'websocket error'));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003, 'text frames only');
      void this.onMessage(client, data.toString()).catch((error: unknown) => {
        this.logger.error({ err: error }, 'websocket message failed');
      });
    });
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    let parsed;
    try {
      parsed = ClientMessageSchema.safeParse(JSON.parse(raw));
    } catch {
      parsed = undefined;
    }
    if (!parsed?.success) return client.ws.close(1007, 'invalid message');
    const message = parsed.data;
    if (message.type !== 'auth' && !client.authenticated) {
      return client.ws.close(WS_CLOSE_UNAUTHENTICATED, 'send auth first');
    }
    switch (message.type) {
      case 'auth':
        return this.authenticate(client, message.token);
      case 'ping':
        return this.send(client, { type: 'pong' });
      case 'resume':
        return this.resume(client, message.lastSeq);
    }
  }

  private async authenticate(client: Client, token: string | null): Promise<void> {
    const principal = token ? await this.cradle.authService.authenticate(token) : null;
    if (token && !principal) {
      if (!client.authenticated)
        return client.ws.close(WS_CLOSE_UNAUTHENTICATED, 'invalid or expired token');
      return this.signOut(client);
    }
    if (!principal && !client.device)
      return client.ws.close(WS_CLOSE_UNAUTHENTICATED, 'sign in or pair this device');
    const first = !client.authenticated;
    client.authenticated = true;
    client.token = token;
    client.principal = principal;
    client.branchId = principal?.branchId ?? client.device!.branchId;
    client.topics = topicsFor(principal);
    if (first || principal)
      this.send(client, { type: 'hello', seq: this.latestSeq(), topics: [...client.topics] });
  }

  /** The access token expired or the session ended: only public messages until a fresh auth. */
  private signOut(client: Client): void {
    client.token = null;
    client.principal = null;
    client.topics = new Set(client.device ? ['tokens'] : []);
    this.send(client, { type: 'unauthenticated' });
  }

  private async revalidate(): Promise<void> {
    for (const client of this.clients) {
      if (!client.token) continue;
      const principal = await this.cradle.authService.authenticate(client.token);
      if (!principal) this.signOut(client);
      else client.topics = topicsFor(principal);
    }
  }

  private resume(client: Client, lastSeq: number): void {
    const latest = this.latestSeq();
    if (lastSeq > latest || latest - lastSeq > MAX_REPLAY) {
      return this.send(client, {
        type: 'resync',
        seq: latest,
        reason: lastSeq > latest ? 'history changed' : 'too far behind',
      });
    }
    const rows = this.cradle.db
      .prepare<
        [number, string],
        {
          seq: number;
          type: string;
          aggregateType: string;
          aggregateId: string;
          branchId: string;
          payload: string;
          occurredAt: string;
        }
      >(
        `SELECT seq, event_type AS type, aggregate_type AS aggregateType, aggregate_id AS aggregateId,
                branch_id AS branchId, payload_json AS payload, occurred_at AS occurredAt
           FROM domain_events WHERE seq > ? AND branch_id = ? ORDER BY seq`,
      )
      .all(lastSeq, client.branchId!);
    const out = dedupe(
      rows.flatMap((r) =>
        messagesFor(this.cradle, {
          ...r,
          payload: JSON.parse(r.payload) as unknown,
          occurredAt: new Date(r.occurredAt),
        }),
      ),
    );
    for (const m of out)
      if (m.topics.some((t) => client.topics.has(t))) this.send(client, m.message);
  }

  // ---- fan-out -----------------------------------------------------------------------------
  private onEvent(event: EventRef): void {
    this.pending.push(...messagesFor(this.cradle, event));
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // One command publishes several events synchronously; send once they're all in.
    setImmediate(() => {
      this.flushScheduled = false;
      const batch = dedupe(this.pending);
      this.pending = [];
      for (const m of batch) this.broadcast(m);
    });
  }

  private broadcast(out: Outgoing): void {
    for (const client of this.clients) {
      if (client.branchId !== out.message.branchId) continue;
      if (!out.topics.some((t) => client.topics.has(t))) continue;
      this.send(client, out.message);
    }
  }

  private send(client: Client, message: ServerMessage | ServerControl): void {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    if (client.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      client.ws.close(4408, 'too far behind; reconnect and resume');
      return;
    }
    client.ws.send(JSON.stringify(message));
  }

  private heartbeat(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }

  private latestSeq(): number {
    return this.cradle.db
      .prepare<[], number>('SELECT coalesce(max(seq), 0) FROM domain_events')
      .pluck()
      .get()!;
  }

  private deviceOf(req: IncomingMessage) {
    const header = req.headers[DEVICE_TOKEN_HEADER];
    const token =
      (typeof header === 'string' && header) || cookieValue(req.headers.cookie, DEVICE_COOKIE);
    if (!token || token.length > 128) return null;
    const ip = req.socket.remoteAddress;
    const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    const device = this.cradle.deviceService.resolve(token, local ? 'LOCALHOST' : 'LAN');
    return device ? { id: device.id, branchId: device.branchId, kind: device.kind } : null;
  }
}

export function topicsFor(principal: Principal | null): Set<WsTopic> {
  const topics = new Set<WsTopic>(['tokens']);
  if (!principal) return topics;
  const has = (p: string) => principal.permissions.has(p);
  if (has('tables.view') || has('billing.create') || has('floor.manage')) topics.add('floor');
  if (has('kds.view')) topics.add('kitchen');
  return topics;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
