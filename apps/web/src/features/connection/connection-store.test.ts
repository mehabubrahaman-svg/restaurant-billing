import { describe, expect, it } from 'vitest';
import {
  deriveConnectionStatus,
  OFFLINE_AFTER_FAILURES,
  type ConnectionSnapshot,
} from './connection-store';

const base: ConnectionSnapshot = {
  browserOnline: true,
  consecutiveFailures: 0,
  hasConnected: true,
  transport: 'lan',
  queuedCount: 0,
};

describe('deriveConnectionStatus', () => {
  it('is live after a successful health check', () => {
    expect(deriveConnectionStatus(base)).toBe('live');
  });

  it('is reconnecting before the Hub has answered once', () => {
    expect(deriveConnectionStatus({ ...base, hasConnected: false })).toBe('reconnecting');
  });

  it('is reconnecting for a few missed polls, then offline', () => {
    expect(deriveConnectionStatus({ ...base, consecutiveFailures: 1 })).toBe('reconnecting');
    expect(
      deriveConnectionStatus({ ...base, consecutiveFailures: OFFLINE_AFTER_FAILURES - 1 }),
    ).toBe('reconnecting');
    expect(deriveConnectionStatus({ ...base, consecutiveFailures: OFFLINE_AFTER_FAILURES })).toBe(
      'offline',
    );
  });

  it('is offline at once when the browser loses the network', () => {
    expect(deriveConnectionStatus({ ...base, browserOnline: false })).toBe('offline');
  });

  it('reports Bluetooth mode while the Bluetooth link carries traffic, even with Wi-Fi down', () => {
    expect(deriveConnectionStatus({ ...base, transport: 'bluetooth', browserOnline: false })).toBe(
      'bluetooth',
    );
  });
});
