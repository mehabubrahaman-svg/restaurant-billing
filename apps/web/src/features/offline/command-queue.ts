import { FireKotsResponseSchema, OrderSchema, type Order } from '@restroos/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { apiClient, isApiError, NetworkError, newIdempotencyKey } from '../../api/client';
import { useAuthStore } from '../auth/auth-store';
import { useConnectionStore } from '../connection/connection-store';
import { setOrder } from '../orders/order-queries';
import { createCommandStore, type CommandStore } from './command-store';
import type { QueuedCommand } from './command-types';

/** What a caller asks to run; the queue adds the bookkeeping. */
export type CommandSpec = Pick<
  QueuedCommand,
  'kind' | 'orderId' | 'method' | 'path' | 'body' | 'lines' | 'itemId'
>;

export type CommandOutcome =
  | { readonly status: 'done'; readonly order: Order }
  | { readonly status: 'queued'; readonly command: QueuedCommand };

/** Replay delays after a failed attempt: 2 s, doubling, at most 30 s (docs/07 §7.3). */
export const REPLAY_BASE_MS = 2_000;
export const REPLAY_MAX_MS = 30_000;

export function replayDelay(attempts: number): number {
  return Math.min(REPLAY_MAX_MS, REPLAY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

interface QueueState {
  /** Oldest first: replayed in the order they were made. */
  readonly commands: readonly QueuedCommand[];
  readonly hydrated: boolean;
}

export const useCommandQueue = create<QueueState>()(() => ({ commands: [], hydrated: false }));

let store: CommandStore = createCommandStore();
let client: QueryClient | null = null;
let hydration: Promise<void> | null = null;
let draining: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function setCommands(update: (commands: readonly QueuedCommand[]) => QueuedCommand[]): void {
  useCommandQueue.setState((s) => ({ commands: update(s.commands) }));
  const waiting = useCommandQueue.getState().commands.filter((c) => c.status !== 'failed').length;
  useConnectionStore.getState().setQueuedCount(waiting);
}

async function persist(command: QueuedCommand): Promise<void> {
  setCommands((list) =>
    list.some((c) => c.id === command.id)
      ? list.map((c) => (c.id === command.id ? command : c))
      : [...list, command].sort((a, b) => a.createdAt - b.createdAt),
  );
  try {
    await store.put(command);
  } catch {
    // Storage full or blocked: the command still lives in memory until reload.
  }
}

async function drop(id: string): Promise<void> {
  setCommands((list) => list.filter((c) => c.id !== id));
  try {
    await store.remove(id);
  } catch {
    // Already gone.
  }
}

/** Loads commands left from before a reload. Commands caught mid-send are queued again. */
function hydrate(): Promise<void> {
  hydration ??= (async () => {
    let saved: QueuedCommand[];
    try {
      saved = await store.list();
    } catch {
      saved = [];
    }
    const restored = saved.map((c) =>
      c.status === 'sending' ? { ...c, status: 'queued' as const } : c,
    );
    setCommands((current) => {
      const ids = new Set(current.map((c) => c.id));
      return [...current, ...restored.filter((c) => !ids.has(c.id))].sort(
        (a, b) => a.createdAt - b.createdAt,
      );
    });
    useCommandQueue.setState({ hydrated: true });
  })();
  return hydration;
}

function currentUserId(): string | null {
  return useAuthStore.getState().session?.user.id ?? null;
}

async function send(command: Pick<QueuedCommand, 'id' | 'kind' | 'method' | 'path' | 'body'>) {
  const options = {
    method: command.method,
    idempotencyKey: command.id,
    ...(command.body === undefined ? {} : { body: command.body }),
  };
  if (command.kind === 'fire') {
    return (await apiClient.json(command.path, FireKotsResponseSchema, options)).order;
  }
  return apiClient.json(command.path, OrderSchema, options);
}

/** Network trouble, a Hub error, or a request still running: try again later, unchanged. */
function isTransient(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (!isApiError(error)) return false;
  return (
    error.status >= 500 ||
    error.code === 'IDEMPOTENCY_IN_PROGRESS' ||
    error.code === 'RATE_LIMITED' ||
    // The session ended: hold the command until someone signs in again.
    error.status === 401
  );
}

function scheduleRetry(attempts: number): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void drainQueue();
  }, replayDelay(attempts));
}

/**
 * Replays queued commands oldest first with their own Idempotency-Key.
 * - 2xx: dequeued, the order in the cache is replaced with the Hub's answer.
 * - Network/5xx: kept, retried with backoff; later commands wait behind it.
 * - Other 4xx (409 VERSION_CONFLICT, ITEM_ALREADY_SENT …): marked "needs attention".
 * Commands queued by someone else on this device wait until they sign in.
 */
export function drainQueue(): Promise<void> {
  draining ??= (async () => {
    await hydrate();
    for (;;) {
      const me = currentUserId();
      const next = useCommandQueue
        .getState()
        .commands.find((c) => c.status === 'queued' && (c.userId === null || c.userId === me));
      if (next === undefined) return;
      const sending: QueuedCommand = { ...next, status: 'sending', attempts: next.attempts + 1 };
      await persist(sending);
      try {
        const order = await send(sending);
        await drop(sending.id);
        if (client !== null) setOrder(client, order);
      } catch (error) {
        if (isTransient(error)) {
          await persist({ ...sending, status: 'queued' });
          scheduleRetry(sending.attempts);
          return;
        }
        await persist({
          ...sending,
          status: 'failed',
          error: isApiError(error)
            ? { code: error.code, status: error.status }
            : { code: 'UNKNOWN', status: 0 },
        });
      }
    }
  })().finally(() => {
    draining = null;
  });
  return draining;
}

/**
 * Runs an order-pad command. While anything is waiting in the queue the new
 * command queues behind it (order matters: items before "send to kitchen").
 * Otherwise it is sent at once; if the Hub can't be reached it is queued with
 * the same Idempotency-Key, so a request that did arrive is never applied twice.
 * A refusal (4xx) is thrown to the caller as usual.
 */
export async function runCommand(spec: CommandSpec): Promise<CommandOutcome> {
  await hydrate();
  const command: QueuedCommand = {
    ...spec,
    id: newIdempotencyKey(),
    userId: currentUserId(),
    createdAt: Date.now(),
    status: 'queued',
    attempts: 0,
    error: null,
  };
  const waiting = useCommandQueue
    .getState()
    .commands.some((c) => c.status === 'queued' || c.status === 'sending');
  if (!waiting) {
    try {
      const order = await send(command);
      if (client !== null) setOrder(client, order);
      return { status: 'done', order };
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
    }
    await persist({ ...command, attempts: 1 });
    scheduleRetry(1);
  } else {
    await persist(command);
    void drainQueue();
  }
  return {
    status: 'queued',
    command: useCommandQueue.getState().commands.find((c) => c.id === command.id) ?? command,
  };
}

/** "Try again" on a command that needs attention. */
export async function retryCommand(id: string): Promise<void> {
  const command = useCommandQueue.getState().commands.find((c) => c.id === id);
  if (command === undefined) return;
  await persist({ ...command, status: 'queued', error: null });
  await drainQueue();
}

/** Throws a queued or failed command away (the captain re-enters it if still wanted). */
export function discardCommand(id: string): Promise<void> {
  return drop(id);
}

/**
 * Starts the queue: loads saved commands and replays them now, when the
 * browser comes back online, and whenever the Hub answers a health check
 * again. Returns a cleanup function.
 */
export function startCommandQueue(queryClient: QueryClient): () => void {
  client = queryClient;
  void drainQueue();
  const online = () => void drainQueue();
  window.addEventListener('online', online);
  const unsubscribe = useConnectionStore.subscribe((s, prev) => {
    if (s.consecutiveFailures === 0 && prev.consecutiveFailures > 0) void drainQueue();
  });
  const signIn = useAuthStore.subscribe((s, prev) => {
    if (s.session?.user.id !== prev.session?.user.id && s.session !== null) void drainQueue();
  });
  return () => {
    window.removeEventListener('online', online);
    unsubscribe();
    signIn();
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    client = null;
  };
}

/** Tests: a fresh, empty queue on the given store. */
export function resetCommandQueue(next: CommandStore): void {
  store = next;
  hydration = null;
  draining = null;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  useCommandQueue.setState({ commands: [], hydrated: false });
  useConnectionStore.getState().setQueuedCount(0);
}
