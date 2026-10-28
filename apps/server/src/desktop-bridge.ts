/**
 * Messages between the Hub server and the desktop app (apps/desktop), which
 * runs it as an Electron utility process. A headless Hub has no parent port
 * and none of this applies.
 */
export type DesktopMessage =
  | { type: 'ready'; httpPort: number; httpsPort: number }
  | { type: 'raster'; id: number; script: string };

export type HubMessage =
  { type: 'shutdown' } | { type: 'raster-result'; id: number; result?: unknown; error?: string };

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

export interface DesktopBridge {
  send(message: DesktopMessage): void;
  onMessage(listener: (message: HubMessage) => void): void;
}

let bridge: DesktopBridge | null | undefined;

/** The channel to the desktop app, or null when the Hub runs headless. */
export function desktopBridge(): DesktopBridge | null {
  if (bridge !== undefined) return bridge;
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
  bridge = port
    ? {
        send: (message) => port.postMessage(message),
        onMessage: (listener) =>
          port.on('message', (event) => {
            const data = event.data as HubMessage | undefined;
            if (data && typeof data === 'object' && 'type' in data) listener(data);
          }),
      }
    : null;
  return bridge;
}
