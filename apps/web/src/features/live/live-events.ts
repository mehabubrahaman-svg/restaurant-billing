import type { ServerMessage } from '@restroos/contracts';

export type LiveListener = (message: ServerMessage) => void;

const listeners = new Set<LiveListener>();

/**
 * Side effects of live messages beyond the cache (chimes, ready alerts,
 * pulsing tokens). Listeners run after the cache has been updated.
 */
export function subscribeLive(listener: LiveListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitLive(message: ServerMessage): void {
  for (const listener of [...listeners]) {
    try {
      listener(message);
    } catch {
      // One broken listener must not stop the others (or the socket).
    }
  }
}
