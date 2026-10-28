import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  Tray,
  utilityProcess,
  type MenuItemConstructorOptions,
  type UtilityProcess,
} from 'electron';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  type WriteStream,
} from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { setLinuxAutostart } from './autostart';
import { loadOrCreateDatabaseKey } from './database-key';
import { HubSupervisor, type HubProcess } from './hub-supervisor';
import { RasterWindow } from './raster-window';
import { readSettings, writeSettings, type DesktopSettings } from './settings';
import { newSetupCode } from './setup-code';
import { startUpdates } from './updates';

const HTTP_PORT = Number(process.env['RESTRO_PORT'] ?? 7400);
const HTTPS_PORT = Number(process.env['RESTRO_HTTPS_PORT'] ?? 7443);
const HUB_URL = `http://127.0.0.1:${HTTP_PORT}`;
const startHidden = process.argv.includes('--hidden');

/** Where the bundled server, web app, migrations and fonts are, packaged or from the repo. */
function resources() {
  if (app.isPackaged) {
    return {
      server: join(app.getAppPath(), 'server-bundle', 'hub-server.mjs'),
      web: join(process.resourcesPath, 'web'),
      migrations: join(process.resourcesPath, 'migrations'),
      fonts: join(process.resourcesPath, 'fonts'),
      icon: join(process.resourcesPath, 'icons', 'tray.png'),
    };
  }
  const root = resolve(__dirname, '..', '..', '..');
  return {
    server: join(root, 'apps', 'desktop', 'server-bundle', 'hub-server.mjs'),
    web: join(root, 'apps', 'web', 'dist'),
    migrations: join(root, 'database', 'migrations'),
    fonts: join(root, 'apps', 'web', 'node_modules', '@fontsource'),
    icon: join(root, 'apps', 'desktop', 'build', 'icons', 'tray.png'),
  };
}

/** Appends the Hub's log to a file, keeping one previous file of up to 10 MB. */
function hubLog(dir: string): WriteStream {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'hub.log');
  if (existsSync(file) && statSync(file).size > 10 * 1024 * 1024) renameSync(file, `${file}.1`);
  return createWriteStream(file, { flags: 'a' });
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
}

function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  const paths = resources();
  const userData = app.getPath('userData');
  const dataDir = process.env['RESTRO_DATA_DIR'] ?? join(userData, 'hub-data');
  const logsDir = join(userData, 'logs');
  const settingsFile = join(userData, 'desktop-settings.json');
  let settings: DesktopSettings = readSettings(settingsFile);
  let window: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let hubReady = false;
  let updateReady: string | null = null;
  const setupCode = newSetupCode();
  /** Shown in the tray until the setup wizard has been completed. */
  let setupPending = false;
  let quitting = false;
  const raster = new RasterWindow();

  const showWindow = () => {
    if (!hubReady) return;
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({
        width: 1366,
        height: 768,
        title: 'RestroOS',
        icon: paths.icon,
        webPreferences: {
          preload: join(__dirname, 'preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      window.removeMenu();
      // Only the Hub's own pages load here; anything else opens in the browser.
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(HUB_URL)) event.preventDefault();
      });
      // Closing the window keeps the Hub serving the other devices.
      window.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        window?.hide();
      });
      void window.loadURL(HUB_URL);
    }
    window.show();
    window.focus();
  };

  const notify = (body: string) => {
    if (Notification.isSupported()) new Notification({ title: 'RestroOS Hub', body }).show();
  };

  const refreshTray = () => {
    if (!tray) return;
    const addresses = lanAddresses();
    const items: MenuItemConstructorOptions[] = [
      { label: 'Open RestroOS', click: showWindow, enabled: hubReady },
      { type: 'separator' },
      {
        label: hubReady ? 'Hub is running' : 'Hub is starting…',
        enabled: false,
      },
      ...(setupPending
        ? [
            {
              label: `Setup code: ${setupCode} (copy)`,
              click: () => clipboard.writeText(setupCode),
            },
          ]
        : []),
      ...addresses.map((ip) => ({
        label: `Copy address https://${ip}:${HTTPS_PORT}`,
        click: () => clipboard.writeText(`https://${ip}:${HTTPS_PORT}`),
      })),
      { type: 'separator' },
      { label: 'Open backups folder', click: () => void shell.openPath(join(dataDir, 'backups')) },
      { label: 'Open logs folder', click: () => void shell.openPath(logsDir) },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: settings.startAtLogin,
        click: (item) => applySettings({ ...settings, startAtLogin: item.checked }),
      },
      {
        label: 'Updates',
        submenu: [
          {
            label: 'Stable',
            type: 'radio',
            checked: settings.updateChannel === 'stable',
            click: () => applySettings({ ...settings, updateChannel: 'stable' }),
          },
          {
            label: 'Beta (pilot builds)',
            type: 'radio',
            checked: settings.updateChannel === 'beta',
            click: () => applySettings({ ...settings, updateChannel: 'beta' }),
          },
        ],
      },
      ...(updateReady
        ? [{ label: `Update ${updateReady} installs when RestroOS next restarts`, enabled: false }]
        : []),
      { type: 'separator' },
      { label: 'Quit RestroOS Hub…', click: () => void confirmQuit() },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(items));
    tray.setToolTip(
      hubReady ? `RestroOS Hub · ${addresses[0] ?? 'no network'}` : 'RestroOS Hub · starting',
    );
  };

  const applySettings = (next: DesktopSettings) => {
    const restartHub = next.backupCopyDir !== settings.backupCopyDir;
    settings = next;
    writeSettings(settingsFile, settings);
    applyAutostart();
    refreshTray();
    if (restartHub) void supervisor.stop().then(() => supervisor.start());
  };

  const applyAutostart = () => {
    if (!app.isPackaged) return;
    if (process.platform === 'linux') {
      setLinuxAutostart(settings.startAtLogin, process.env['APPIMAGE'] ?? process.execPath);
    } else {
      app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, args: ['--hidden'] });
    }
  };

  const confirmQuit = async () => {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Keep running', 'Quit'],
      defaultId: 0,
      cancelId: 0,
      message: 'Quit RestroOS Hub?',
      detail:
        'Captain tablets, kitchen screens and billing counters stop working until it is started again.',
    });
    if (response === 1) app.quit();
  };

  const spawnHub = (): HubProcess => {
    const { key, protectedBy } = loadOrCreateDatabaseKey(
      join(userData, 'keys'),
      safeStorage,
      existsSync(join(dataDir, 'restro.db')),
    );
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_ENV: 'production',
      RESTRO_DATA_DIR: dataDir,
      RESTRO_DB_KEY: key,
      RESTRO_PORT: String(HTTP_PORT),
      RESTRO_HTTPS_PORT: String(HTTPS_PORT),
      RESTRO_HOST: '0.0.0.0',
      RESTRO_WEB_DIST: paths.web,
      RESTRO_MIGRATIONS_DIR: paths.migrations,
      RESTRO_FONTS_DIR: paths.fonts,
      RESTRO_SECURE_COOKIES: 'false',
      RESTRO_SETUP_CODE: setupCode,
    };
    if (settings.backupCopyDir) env['RESTRO_BACKUP_COPY_DIR'] = settings.backupCopyDir;
    const child: UtilityProcess = utilityProcess.fork(paths.server, [], {
      env,
      stdio: 'pipe',
      serviceName: 'RestroOS Hub',
    });
    const log = hubLog(logsDir);
    log.write(`--- starting Hub (database key protected by ${protectedBy}) ---\n`);
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.on('message', (message: { type?: string; id?: number; script?: string }) => {
      if (message.type === 'ready') {
        hubReady = true;
        refreshTray();
        if (!startHidden) showWindow();
        void showSetupCodeIfNeeded();
      } else if (message.type === 'raster' && typeof message.script === 'string') {
        raster.run(message.script).then(
          (result) => child.postMessage({ type: 'raster-result', id: message.id, result }),
          (error: Error) =>
            child.postMessage({ type: 'raster-result', id: message.id, error: error.message }),
        );
      }
    });
    return {
      onExit: (listener) =>
        child.once('exit', (code) => {
          hubReady = false;
          refreshTray();
          log.end();
          listener(code);
        }),
      postMessage: (message) => child.postMessage(message),
      kill: () => void child.kill(),
    };
  };

  const needsSetup = async () =>
    ((await (await fetch(`${HUB_URL}/api/v1/setup/status`)).json()) as { needsSetup: boolean })
      .needsSetup;

  /** A new Hub opens on the setup wizard, which asks for this code. */
  const showSetupCodeIfNeeded = async () => {
    try {
      setupPending = await needsSetup();
    } catch {
      return;
    }
    refreshTray();
    if (!setupPending) return;
    // Drop the code from the tray once the wizard is done.
    const watch = setInterval(() => {
      needsSetup()
        .then((needed) => {
          if (needed) return;
          setupPending = false;
          clearInterval(watch);
          refreshTray();
        })
        .catch(() => undefined);
    }, 30_000);
    const options = {
      type: 'info' as const,
      buttons: ['Copy code', 'OK'],
      defaultId: 0,
      message: `Setup code: ${setupCode}`,
      detail:
        'Enter this code on the last step of the setup wizard. It is also in the tray menu until setup is finished.',
    };
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (response === 0) clipboard.writeText(setupCode);
  };

  const supervisor = new HubSupervisor({
    spawn: spawnHub,
    onRestart: (reason) => {
      if (reason === 'restore') notify('Restoring the backup: the Hub is restarting.');
    },
    onGiveUp: () => {
      dialog.showErrorBox(
        'RestroOS Hub keeps stopping',
        `The Hub server stopped 5 times in 2 minutes. See the log in ${logsDir} and call support. Your data is safe in ${dataDir}.`,
      );
    },
  });

  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => {
    // Stay in the tray: the Hub must keep serving the LAN.
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void supervisor.stop().finally(() => {
      raster.close();
      app.exit(0);
    });
  });

  ipcMain.handle('desktop:version', () => app.getVersion());
  ipcMain.handle('desktop:open-backups', () => shell.openPath(join(dataDir, 'backups')));
  ipcMain.handle('desktop:choose-backup-copy-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a second backup folder (USB drive or network share)',
      properties: ['openDirectory', 'createDirectory'],
    });
    const dir = result.canceled ? null : (result.filePaths[0] ?? null);
    if (dir) applySettings({ ...settings, backupCopyDir: dir });
    return dir;
  });

  void app.whenReady().then(() => {
    tray = new Tray(nativeImage.createFromPath(paths.icon));
    tray.on('click', showWindow);
    refreshTray();
    applyAutostart();
    try {
      supervisor.start();
    } catch (error) {
      dialog.showErrorBox('RestroOS Hub cannot start', (error as Error).message);
      app.exit(1);
      return;
    }
    if (app.isPackaged) {
      startUpdates(settings.updateChannel, {
        onReady: (version) => {
          updateReady = version;
          refreshTray();
          notify(`Version ${version} is ready and installs when RestroOS next restarts.`);
        },
        onError: () => {
          // Offline or no update server: try again later.
        },
      });
    }
  });
}

main();
