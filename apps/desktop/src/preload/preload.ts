import { contextBridge, ipcRenderer } from 'electron';

/**
 * What the Hub's own window can ask of the desktop app. The web app checks
 * for `window.restroDesktop` and otherwise runs as a normal browser client.
 */
contextBridge.exposeInMainWorld('restroDesktop', {
  platform: process.platform,
  version: (): Promise<string> => ipcRenderer.invoke('desktop:version'),
  openBackupsFolder: (): Promise<void> => ipcRenderer.invoke('desktop:open-backups'),
  chooseBackupCopyFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('desktop:choose-backup-copy-dir'),
});
