import type { ClientMessage } from '@restroos/contracts';
import type { SocketLike } from '../features/live/ws-client';

/**
 * A WebSocket stand-in: records what the app sends and lets a test play the
 * Hub (`open`, `receive`, `drop`). Every app render gets one through
 * `setSocketFactory` (see setup.ts), so no test touches the network.
 */
export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];

  /** The newest socket the app opened. */
  static get last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (socket === undefined) throw new Error('the app has not opened a socket');
    return socket;
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  readyState = 0;
  readonly sent: ClientMessage[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closedByApp = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    this.closedByApp = true;
    this.readyState = 3;
  }

  // ---- the Hub's side ----

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  /** The connection drops (Wi-Fi gone, Hub restarted). */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

export const fakeSocketFactory = (url: string) => new FakeSocket(url);
