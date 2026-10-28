import type { ConnectionStatus } from '@restroos/ui';
import { create } from 'zustand';

/** Which link to the Hub is carrying traffic. Bluetooth fallback arrives in Phase 1.5. */
export type Transport = 'lan' | 'bluetooth';

export interface ConnectionSnapshot {
  /** `navigator.onLine`: false means the device has no network at all. */
  readonly browserOnline: boolean;
  /** Health checks failed in a row since the last success. */
  readonly consecutiveFailures: number;
  /** Whether the Hub has answered at least once since the app started. */
  readonly hasConnected: boolean;
  readonly transport: Transport;
  /** Commands waiting in the offline queue (filled by the captain app's IndexedDB queue). */
  readonly queuedCount: number;
}

/** Three missed polls (~15 s) before "reconnecting" turns into "offline". */
export const OFFLINE_AFTER_FAILURES = 3;

export function deriveConnectionStatus(s: ConnectionSnapshot): ConnectionStatus {
  // Wi-Fi may be down while orders still flow over Bluetooth.
  if (s.transport === 'bluetooth') return 'bluetooth';
  if (!s.browserOnline) return 'offline';
  if (s.consecutiveFailures === 0) return s.hasConnected ? 'live' : 'reconnecting';
  return s.consecutiveFailures >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting';
}

interface ConnectionState extends ConnectionSnapshot {
  reportSuccess(): void;
  reportFailure(): void;
  setBrowserOnline(online: boolean): void;
  setTransport(transport: Transport): void;
  setQueuedCount(count: number): void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  consecutiveFailures: 0,
  hasConnected: false,
  transport: 'lan',
  queuedCount: 0,
  reportSuccess: () => set({ consecutiveFailures: 0, hasConnected: true }),
  reportFailure: () => set((s) => ({ consecutiveFailures: s.consecutiveFailures + 1 })),
  setBrowserOnline: (browserOnline) => set({ browserOnline }),
  setTransport: (transport) => set({ transport }),
  setQueuedCount: (queuedCount) => set({ queuedCount }),
}));

export function useConnectionStatus(): ConnectionStatus {
  return useConnectionStore(deriveConnectionStatus);
}
