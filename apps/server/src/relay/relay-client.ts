import type { RelayIntegrationService, RelayLinkRecord } from '@restroos/application';
import { RELAY_HUB_PATH, RelayToHubSchema, type HubToRelay } from '@restroos/contracts';
import type { Logger } from 'pino';
import { WebSocket } from 'ws';

export type RelayState = 'OFF' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

export interface RelayStatus {
  state: RelayState;
  /** When the state last changed. */
  since: string;
  lastConnectedAt: string | null;
  lastError: string | null;
}

const MAX_BACKOFF_MS = 60_000;
const PING_MS = 25_000;

/** The relay's WebSocket address for a link: https:// becomes wss://. */
export function hubSocketUrl(link: Pick<RelayLinkRecord, 'relayUrl' | 'hubId'>): string {
  const base = link.relayUrl.replace(/^http(s?):\/\//, 'ws$1://').replace(/\/+$/, '');
  return `${base}${RELAY_HUB_PATH}?hub=${encodeURIComponent(link.hubId)}`;
}

/**
 * The Hub's outbound connection to the relay (one branch). Reconnects with
 * backoff, hands each delivered webhook to the integration service and
 * answers with its result, and sends whatever is queued for the relay.
 */
export class RelayClient {
  private ws: WebSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ping: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = true;
  private status: RelayStatus = {
    state: 'OFF',
    since: new Date().toISOString(),
    lastConnectedAt: null,
    lastError: null,
  };

  constructor(
    private readonly d: {
      service: RelayIntegrationService;
      branchId: () => string | null;
      logger: Logger;
    },
  ) {}

  current(): RelayStatus {
    return this.status;
  }

  /** Connects if the branch's link is on; call again after the link changes. */
  restart(): void {
    this.stop();
    const branchId = this.d.branchId();
    const link = branchId ? this.d.service.link(branchId) : undefined;
    if (!link?.isEnabled) return;
    this.stopped = false;
    this.attempt = 0;
    this.connect(link);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.ping) clearInterval(this.ping);
    this.timer = null;
    this.ping = null;
    const ws = this.ws;
    this.ws = null;
    ws?.removeAllListeners();
    ws?.on('error', () => {});
    ws?.terminate();
    this.set('OFF');
  }

  /** Sends what is queued, if connected (called after something is queued). */
  flush(): void {
    const ws = this.ws;
    const branchId = this.d.branchId();
    if (!ws || ws.readyState !== WebSocket.OPEN || !branchId) return;
    for (const m of this.d.service.pendingOut(branchId)) {
      this.send({
        type: 'send',
        id: m.id,
        kind: m.kind as 'menu' | 'availability' | 'order-status',
        payload: m.payload,
      });
    }
  }

  private connect(link: RelayLinkRecord): void {
    this.set('CONNECTING');
    const ws = new WebSocket(hubSocketUrl(link), {
      headers: { authorization: `Bearer ${link.hubKey}` },
      handshakeTimeout: 15_000,
    });
    this.ws = ws;
    ws.on('open', () => {
      this.attempt = 0;
      this.status.lastConnectedAt = new Date().toISOString();
      this.status.lastError = null;
      this.set('CONNECTED');
      this.d.logger.info({ relay: link.relayUrl }, 'connected to the relay');
      this.ping = setInterval(() => ws.ping(), PING_MS);
      this.ping.unref();
      this.flush();
    });
    ws.on('message', (data) => this.onMessage(link, String(data)));
    ws.on('unexpected-response', (_req, res) => {
      this.status.lastError =
        res.statusCode === 401
          ? 'the relay refused the hub id or key'
          : `the relay answered ${res.statusCode}`;
    });
    ws.on('error', (error) => {
      this.status.lastError ??= error.message;
    });
    ws.on('close', (code, reason) => {
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      if (this.ws !== ws) return;
      this.ws = null;
      if (code === 4409) this.status.lastError = 'another Hub connected with the same hub id';
      else if (reason.length > 0) this.status.lastError ??= reason.toString();
      this.set('DISCONNECTED');
      if (!this.stopped) this.retry(link);
    });
  }

  private retry(link: RelayLinkRecord): void {
    const delay = Math.min(1_000 * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.connect(link);
    }, delay);
    this.timer.unref();
  }

  private onMessage(link: RelayLinkRecord, raw: string): void {
    let message;
    try {
      message = RelayToHubSchema.parse(JSON.parse(raw));
    } catch (error) {
      this.d.logger.warn({ err: error }, 'ignored a message from the relay that is not understood');
      return;
    }
    if (message.type === 'stored') {
      this.d.service.markSent(message.id);
      return;
    }
    let result: { ok: boolean; error?: string };
    try {
      result = this.d.service.receive(link.branchId, message.id, message.message);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!result.ok)
      this.d.logger.warn({ id: message.id, error: result.error }, 'online order not entered');
    this.send({
      type: 'ack',
      id: message.id,
      ok: result.ok,
      ...(result.error ? { error: result.error.slice(0, 500) } : {}),
    });
    // An accepted order queues its status for the platform.
    this.flush();
  }

  private send(message: HubToRelay): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private set(state: RelayState): void {
    if (this.status.state !== state)
      this.status = { ...this.status, state, since: new Date().toISOString() };
  }
}
