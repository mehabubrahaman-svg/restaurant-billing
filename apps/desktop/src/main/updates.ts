import { autoUpdater } from 'electron-updater';

export interface UpdateEvents {
  onReady(version: string): void;
  onError(error: Error): void;
}

const CHECK_EVERY_MS = 6 * 60 * 60_000;

/**
 * Auto-update (WP 5.9). Updates download in the background when the Hub is
 * online and install only when the app next quits or restarts, never in the
 * middle of service. `beta` gets pilot builds before `stable`.
 */
export function startUpdates(channel: 'stable' | 'beta', events: UpdateEvents): () => void {
  autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest';
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => events.onReady(info.version));
  autoUpdater.on('error', (error) => events.onError(error));
  // Offline is normal for a restaurant; a failed check just waits for the next one.
  const check = () =>
    void autoUpdater.checkForUpdates().catch((error: Error) => events.onError(error));
  const first = setTimeout(check, 60_000);
  const timer = setInterval(check, CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
