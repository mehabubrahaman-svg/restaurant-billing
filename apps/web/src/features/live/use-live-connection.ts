import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { refreshSession, useAuthStore } from '../auth/auth-store';
import { useConnectionStore } from '../connection/connection-store';
import { useDeviceStore } from '../../stores/device-store';
import { applyLiveMessage, resyncAll } from './apply-message';
import { emitLive } from './live-events';
import { LiveSocket, liveUrl, type SocketLike } from './ws-client';

let socketFactory: ((url: string) => SocketLike) | null = null;

/** Tests swap in a fake socket; the app uses the browser's WebSocket. */
export function setSocketFactory(factory: ((url: string) => SocketLike) | null): void {
  socketFactory = factory;
}

/**
 * The app's single live connection. Mount once, at the root. It runs while
 * someone is signed in, and on a paired token display without anyone signed
 * in (`auth` with `token: null`). Messages update the React Query cache and
 * then reach `subscribeLive` listeners.
 */
export function useLiveConnection(): void {
  const client = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const token = useAuthStore((s) => s.session?.accessToken ?? null);
  const kind = useDeviceStore((s) => s.kind);
  const enabled =
    status === 'authenticated' || (status === 'anonymous' && kind === 'TOKEN_DISPLAY');
  const socketRef = useRef<LiveSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const setLive = useConnectionStore.getState().setLive;
    const socket = new LiveSocket({
      url: liveUrl(),
      token: () => useAuthStore.getState().session?.accessToken ?? null,
      onMessage: (message) => {
        applyLiveMessage(client, message);
        emitLive(message);
      },
      onResync: () => void resyncAll(client),
      onUnauthenticated: () => {
        // A fresh token re-sends `auth` (effect below); nobody signed in has none to renew.
        if (useAuthStore.getState().session !== null) void refreshSession();
      },
      onStatus: setLive,
      ...(socketFactory === null ? {} : { createSocket: socketFactory }),
    });
    socketRef.current = socket;
    socket.start();
    const online = () => socket.reconnectNow();
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      socket.stop();
      socketRef.current = null;
      setLive('idle');
    };
  }, [enabled, client]);

  // Every refreshed access token (and a branch switch) is sent as a new `auth`.
  useEffect(() => {
    socketRef.current?.reauth();
  }, [token]);
}
