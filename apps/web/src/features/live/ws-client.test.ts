import { WS_CLOSE_UNAUTHENTICATED, type ServerMessage } from '@restroos/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket } from '../../test/fake-socket';
import { LiveSocket, liveUrl, PING_INTERVAL_MS } from './ws-client';

const BRANCH = '11111111-1111-4111-8111-111111111111';
const TABLE = 'f1000000-0000-4000-8000-000000000001';

const tableMessage = (seq: number, version = seq): ServerMessage => ({
  type: 'floor.table.status_changed',
  seq,
  branchId: BRANCH,
  occurredAt: '2026-10-28T10:00:00.000Z',
  data: { tableId: TABLE, status: 'OCCUPIED', orderId: null, version },
});

function setup(token = 'access-1') {
  let current: string | null = token;
  const onMessage = vi.fn();
  const onResync = vi.fn();
  const onUnauthenticated = vi.fn();
  const onStatus = vi.fn();
  const socket = new LiveSocket({
    url: 'ws://hub.test/ws',
    token: () => current,
    onMessage,
    onResync,
    onUnauthenticated,
    onStatus,
    createSocket: (url) => new FakeSocket(url),
    backoffMs: [1_000, 2_000, 5_000],
    random: () => 0.5, // no jitter
  });
  return {
    socket,
    onMessage,
    onResync,
    onUnauthenticated,
    onStatus,
    setToken: (next: string | null) => {
      current = next;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LiveSocket', () => {
  it('builds the socket URL on the page origin, wss under https', () => {
    expect(liveUrl({ protocol: 'http:', host: '192.168.1.5:7400' })).toBe(
      'ws://192.168.1.5:7400/ws',
    );
    expect(liveUrl({ protocol: 'https:', host: 'restro.local:7443' })).toBe(
      'wss://restro.local:7443/ws',
    );
  });

  it('sends auth first, takes hello’s seq, and passes entity messages on', () => {
    const { socket, onMessage, onStatus } = setup();
    socket.start();
    const ws = FakeSocket.last;
    expect(ws.url).toBe('ws://hub.test/ws');
    ws.open();
    expect(ws.sent).toEqual([{ type: 'auth', token: 'access-1' }]);
    expect(onStatus).toHaveBeenLastCalledWith('connecting');

    ws.receive({ type: 'hello', seq: 40, topics: ['floor'] });
    expect(onStatus).toHaveBeenLastCalledWith('open');
    expect(socket.lastSeq).toBe(40);

    ws.receive(tableMessage(41));
    ws.receive({ type: 'nonsense' });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(socket.lastSeq).toBe(41);
    // Messages are applied by version, so an older seq arriving late never lowers lastSeq.
    ws.receive(tableMessage(39));
    expect(socket.lastSeq).toBe(41);
  });

  it('pings every 25 s while open', () => {
    const { socket } = setup();
    socket.start();
    const ws = FakeSocket.last;
    ws.open();
    ws.receive({ type: 'hello', seq: 1, topics: [] });
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(ws.sent.filter((m) => m.type === 'ping')).toHaveLength(2);
  });

  it('reconnects with backoff, re-authenticates and resumes from lastSeq', () => {
    const { socket, onStatus } = setup();
    socket.start();
    let ws = FakeSocket.last;
    ws.open();
    ws.receive({ type: 'hello', seq: 10, topics: ['floor'] });
    ws.receive(tableMessage(12));

    ws.drop();
    expect(onStatus).toHaveBeenLastCalledWith('down');
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    // The second attempt fails too: the wait grows.
    FakeSocket.last.drop();
    vi.advanceTimersByTime(1_999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    ws = FakeSocket.last;
    ws.open();
    expect(ws.sent).toEqual([{ type: 'auth', token: 'access-1' }]);
    ws.receive({ type: 'hello', seq: 15, topics: ['floor'] });
    expect(ws.sent).toContainEqual({ type: 'resume', lastSeq: 12 });
    expect(onStatus).toHaveBeenLastCalledWith('open');

    // A successful hello resets the backoff.
    ws.drop();
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it('does not resume when nothing was missed', () => {
    const { socket } = setup();
    socket.start();
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'hello', seq: 7, topics: [] });
    FakeSocket.last.drop();
    vi.advanceTimersByTime(1_000);
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'hello', seq: 7, topics: [] });
    expect(FakeSocket.last.sent.map((m) => m.type)).toEqual(['auth']);
  });

  it('asks for a refetch on resync and adopts its seq', () => {
    const { socket, onResync } = setup();
    socket.start();
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'hello', seq: 5, topics: [] });
    FakeSocket.last.receive({ type: 'resync', seq: 900, reason: 'gap too large' });
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(socket.lastSeq).toBe(900);
  });

  it('resyncs when the Hub’s sequence went backwards (restored backup)', () => {
    const { socket, onResync } = setup();
    socket.start();
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'hello', seq: 500, topics: [] });
    FakeSocket.last.drop();
    vi.advanceTimersByTime(1_000);
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'hello', seq: 20, topics: [] });
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(socket.lastSeq).toBe(20);
  });

  it('re-sends auth with the new token after a refresh, and on `unauthenticated` asks for one', () => {
    const { socket, setToken, onUnauthenticated } = setup();
    socket.start();
    const ws = FakeSocket.last;
    ws.open();
    ws.receive({ type: 'hello', seq: 1, topics: [] });
    ws.receive({ type: 'unauthenticated' });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    setToken('access-2');
    socket.reauth();
    expect(ws.sent.filter((m) => m.type === 'auth')).toEqual([
      { type: 'auth', token: 'access-1' },
      { type: 'auth', token: 'access-2' },
    ]);
  });

  it('treats a 4401 close as an expired token and reconnects', () => {
    const { socket, onUnauthenticated } = setup();
    socket.start();
    FakeSocket.last.open();
    FakeSocket.last.drop(WS_CLOSE_UNAUTHENTICATED);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('sends token null for a token display with nobody signed in', () => {
    const display = new LiveSocket({
      url: 'ws://hub.test/ws',
      token: () => null,
      onMessage: () => undefined,
      onResync: () => undefined,
      onUnauthenticated: () => undefined,
      createSocket: (url) => new FakeSocket(url),
    });
    display.start();
    FakeSocket.last.open();
    expect(FakeSocket.last.sent).toEqual([{ type: 'auth', token: null }]);
    display.stop();
  });

  it('stops for good: no reconnect after stop()', () => {
    const { socket, onStatus } = setup();
    socket.start();
    FakeSocket.last.open();
    socket.stop();
    expect(FakeSocket.last.closedByApp).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith('idle');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
