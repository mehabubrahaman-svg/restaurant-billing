# RestroOS Hub (desktop app)

The Electron app installed on the restaurant's Hub PC. It runs the Hub server
(`apps/server`, bundled into `server-bundle/`) as an Electron utility process
and keeps it running, and it owns what needs the operating system:

| Concern                                                                                                            | Where                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Restart on crash (backoff, gives up after 5 in 2 min) and on restore (exit 75)                                     | `src/main/hub-supervisor.ts`                                      |
| Database key: random, sealed with the OS keychain (DPAPI / libsecret), never regenerated over an existing database | `src/main/database-key.ts`                                        |
| Hindi/Bengali receipts: renders the Hub's raster script in an offscreen window                                     | `src/main/raster-window.ts` + `apps/server/src/desktop-bridge.ts` |
| Start at login (hidden in the tray)                                                                                | `src/main/autostart.ts`, Electron login items on Windows          |
| Auto-update, stable/beta channels, installs only on the next restart                                               | `src/main/updates.ts`                                             |
| Tray: open, LAN addresses, backups and logs folders, quit with a warning                                           | `src/main/main.ts`                                                |

Closing the window keeps the Hub serving the other devices; only **Quit** in
the tray stops it. Logs go to `<userData>/logs/hub.log`, data to
`<userData>/hub-data` (override with `RESTRO_DATA_DIR`).

## Develop

```bash
pnpm --filter @restroos/web build
pnpm --filter @restroos/desktop build
pnpm --filter @restroos/desktop start
```

## Installers

```bash
pnpm --filter @restroos/desktop package
```

Builds a Windows NSIS installer on Windows and an AppImage + deb on Linux,
into `apps/desktop/release/`. electron-builder downloads Electron and its
packaging tools from GitHub and rebuilds the native SQLite module for
Electron, so it must run on the target OS with internet access. The
**Desktop installers** workflow (`.github/workflows/desktop.yml`) does both,
and starts the Linux AppImage under Xvfb to check the Hub really comes up.

The update feed URL in `electron-builder.yml` is a placeholder until the
update server exists; code signing (Windows Authenticode) is not set up yet,
so Windows SmartScreen will warn on install.

A Hub without a screen can run the server alone as a systemd service:
`deploy/linux/restroos-hub.service`.
