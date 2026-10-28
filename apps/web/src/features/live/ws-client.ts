import {
  ServerControlSchema,
  ServerMessageSchema,
  WS_CLOSE_UNAUTHENTICATED,
  WS_PATH,
  type ClientMessage,
  type ServerMessage,
} from '@restroos/contracts';

/**
 * - `idle`: not started (or stopped).
 * - `connecting`: opening the socket, or waiting for `hello` after `auth`.
 * - `open`: authenticated; live messages flow.
 * - `down`: the socket closed; a reconnect is scheduled.
 */
export type LiveStatus = 'idle' | 'connecting' | 'open' | 'down';

/** The subset of the browser WebSocket the client uses, so tests can pass a fake. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface LiveSocketOptions {
  readonly url: string;
  /** The current access token; `null` for a paired token display with nobody signed in. */
  readonly token: () => string | null;
  /** An entity message, after `lastSeq` has been advanced. */
  readonly onMessage: (message: ServerMessage) => void;
  /** The server could not replay the gap (or this is a new branch): refetch everything. */
  readonly onResync: () => void;
  /** The server rejected the token: renew it; `reauth()` is called once a new one exists. */
  readonly onUnauthenticated: () => void;
  readonly onStatus?: (status: LiveStatus) => void;
  readonly createSocket?: (url: string) => SocketLike;
  /** Reconnect delays in ms; the last one repeats. ±20% jitter is added. */
  readonly backoffMs?: readonly number[];
  readonly pingMs?: number;
  readonly random?: () => number;
}

export const PING_INTERVAL_MS = 25_000;
export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000] as const;
const OPEN = 1;

/** `ws://host/ws` or `wss://host/ws`, on the origin the app was loaded from. */
export function liveUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`;
}

/**
 * The app's one live connection to the Hub (docs/05 §5).
 *
 * The first message is always `auth`. After a reconnect it also sends
 * `resume {lastSeq}` so the server replays what was missed, or answers
 * `resync` (refetch everything). Pings every 25 s keep the socket alive
 * through Wi-Fi access points that drop idle connections.
 */
export class LiveSocket {
  private socket: SocketLike | null = null;
  private status: LiveStatus = 'idle';
  private seq: number | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(private readonly options: LiveSocketOptions) {}

  /** The highest event sequence seen; sent back in `resume`. */
  get lastSeq(): number | null {
    return this.seq;
  }

  get currentStatus(): LiveStatus {
    return this.status;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close(1000, 'stopped');
    }
    this.setStatus('idle');
  }

  /** Sends `auth` again with the current token (after every refresh). */
  reauth(): void {
    if (this.socket?.readyState === OPEN) this.send({ type: 'auth', token: this.options.token() });
  }

  /** Reconnect now instead of waiting out the backoff (e.g. the browser came back online). */
  reconnectNow(): void {
    if (this.stopped || this.status === 'open' || this.status === 'connecting') return;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connect();
  }

  private connect(): void {
    this.setStatus('connecting');
    let socket: SocketLike;
    try {
      socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.send({ type: 'auth', token: this.options.token() });
    };
    socket.onmessage = (event) => this.receive(event.data);
    socket.onerror = () => {
      // A close event always follows; reconnecting is handled there.
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearPing();
      if (event.code === WS_CLOSE_UNAUTHENTICATED) this.options.onUnauthenticated();
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    const control = ServerControlSchema.safeParse(raw);
    if (control.success) {
      const message = control.data;
      switch (message.type) {
        case 'hello':
          this.attempt = 0;
          if (this.seq === null) {
            this.seq = message.seq;
          } else if (message.seq > this.seq) {
            this.send({ type: 'resume', lastSeq: this.seq });
          } else if (message.seq < this.seq) {
            // The Hub's sequence went back (restored from a backup): our copy can't be trusted.
            this.seq = message.seq;
            this.options.onResync();
          }
          this.setStatus('open');
          this.startPing();
          return;
        case 'resync':
          this.seq = message.seq;
          this.options.onResync();
          return;
        case 'unauthenticated':
          this.options.onUnauthenticated();
          return;
        case 'pong':
          return;
      }
    }
    const parsed = ServerMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (this.seq === null || message.seq > this.seq) this.seq = message.seq;
    this.options.onMessage(message);
  }

  private send(message: ClientMessage): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // The socket is closing; the close handler reconnects.
    }
  }

  private scheduleReconnect(): void {
    this.setStatus('down');
    const steps = this.options.backoffMs ?? RECONNECT_BACKOFF_MS;
    const base = steps[Math.min(this.attempt, steps.length - 1)] ?? 30_000;
    const jitter = 0.8 + (this.options.random ?? Math.random)() * 0.4;
    this.attempt += 1;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        if (!this.stopped) this.connect();
      },
      Math.round(base * jitter),
    );
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(
      () => this.send({ type: 'ping' }),
      this.options.pingMs ?? PING_INTERVAL_MS,
    );
  }

  private clearPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: LiveStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }
}
