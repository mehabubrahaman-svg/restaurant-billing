# 12 — Install and Run

Two ways to run RestroOS on a desktop or laptop PC (the **Hub**), and how the
other devices connect to it.

| | A. Desktop app (installer) | B. From source with `pnpm hub` |
| --- | --- | --- |
| For | The restaurant's Hub PC | Trying it out, development, a Hub without a screen |
| You need | The installer file | Node.js 22, pnpm, Git |
| Starts with the PC, tray icon, auto-update | Yes | No (use the systemd unit for a server) |
| Database key protected by | The OS keychain | A key file next to the data |
| Hindi/Bengali receipts as images | Yes (built in) | Only if Playwright's Chromium is installed |

## A. Install the desktop app

### 1. Get the installer

The installers are built by GitHub Actions, on Windows and Linux:

1. On GitHub, open the repository → **Actions** → **Desktop installers** →
   **Run workflow** (pick the branch), or push a tag such as `hub-v0.1.0`.
2. When the run finishes (about 10–15 minutes), open it and download the
   artifact: **restroos-hub-Windows** (`RestroOS Hub Setup 0.1.0.exe`) or
   **restroos-hub-Linux** (`.AppImage` and `.deb`).

The Linux job starts the AppImage and checks that the Hub answers before
it publishes the files.

### 2. Install

**Windows 10/11**: run `RestroOS Hub Setup 0.1.0.exe`. The installer isn't
code-signed yet, so Windows SmartScreen says *Windows protected your PC*:
choose **More info → Run anyway**. Choose the folder and finish; RestroOS
starts.

**Ubuntu / Debian**:

```bash
sudo apt install ./restroos-hub_0.1.0_amd64.deb
```

Then start **RestroOS Hub** from the applications menu. Or, with the
AppImage (no install):

```bash
chmod +x RestroOS-Hub-0.1.0.AppImage
```

```bash
./RestroOS-Hub-0.1.0.AppImage
```

(On Ubuntu 22.04+ the AppImage needs `libfuse2`: `sudo apt install libfuse2`.)

### 3. First start

1. The RestroOS window opens on the **setup wizard**, and the app sits in the
   system tray. Closing the window keeps the Hub running for the other
   devices; **Quit** from the tray menu stops it.
2. A message shows the **setup code** (it is also in the tray menu, with
   *copy*, until setup is finished). The wizard asks for it on its last step.
3. Fill in the business, branch and state, liquor settings, receipt
   languages, the owner's account, and the **backup passphrase** (write it
   down: it can't be recovered). Finish: you are signed in as the owner.
4. Follow [the pilot runbook](10-pilot-runbook.md) §2–3 to add the menu,
   tables, staff, printers and devices.

Where things are: data in the app's user-data folder (`%APPDATA%\RestroOS Hub\hub-data`
on Windows, `~/.config/RestroOS Hub/hub-data` on Linux), with `backups/`
inside it; logs in `logs/` beside it. The tray menu opens both.

## B. Run from source (`pnpm hub`)

Works on Windows, Linux and macOS. Install [Node.js 22](https://nodejs.org/)
and Git, then enable pnpm:

```bash
corepack enable
```

Get the code and build it (the first install takes a few minutes):

```bash
git clone https://github.com/mehabubrahaman-svg/restaurant-billing.git
```

```bash
cd restaurant-billing
```

```bash
pnpm install
```

```bash
pnpm build
```

Start the Hub:

```bash
pnpm hub
```

It prints the addresses and, the first time, the **setup code**:

```
Starting the RestroOS Hub. Open http://localhost:7400 on this PC
Other devices on the network: http://192.168.1.20:7400
… FIRST-TIME SETUP: open the Hub in a browser and enter setup code KCMBYCGX
```

Open <http://localhost:7400> in Chrome or Edge and run the setup wizard.
Stop the Hub with **Ctrl+C**; `pnpm hub` again starts it with the same data.

- Data goes to `./data` in the checkout; `pnpm hub --data D:\RestroOS` puts
  it elsewhere. The first run writes a random database key to
  `data/db.key`. **Keep `db.key` with the data**: without it the database
  can't be opened (backups still restore with the backup passphrase).
- Any setting from `apps/server/src/config.ts` can be given as an
  environment variable, e.g. a different port:

  ```bash
  RESTRO_PORT=8080 pnpm hub
  ```

- A backup restore restarts the Hub; `pnpm hub` starts it again by itself.
- After `git pull`, run `pnpm install` and `pnpm build` again. Database
  migrations apply on the next start, after an automatic backup.
- For Hindi/Bengali receipts as images, install Chromium for Playwright
  once: `pnpm --filter @restroos/e2e exec playwright install chromium`.
  Without it, receipts print in English.
- A Linux Hub without a screen can run as a service:
  [`deploy/linux/restroos-hub.service`](../deploy/linux/restroos-hub.service).

## Connect the other devices

Every other device is just a browser; nothing is installed on it.

1. Put the tablet, phone or PC on the **same Wi-Fi/network** as the Hub.
2. Open the Hub's address in Chrome, e.g. `http://192.168.1.20:7400` (the
   tray menu or `pnpm hub` shows it).
   - If the page doesn't load, allow the port through the Hub PC's firewall.
     Windows: allow *RestroOS Hub* (or Node.js) on **Private** networks when
     asked.
3. Sign in with a staff password. To use PIN sign-in and remember the device's
   role (captain tablet, kitchen screen, token TV), the owner pairs it:
   **Admin → Devices → Pair a device**, then scan the QR code on the tablet.
4. Add it to the home screen (Chrome menu → **Add to Home screen**) so it
   opens full screen.

Give the Hub PC a fixed IP address on the router (DHCP reservation) so the
address doesn't change.

## Check that everything works

`pnpm check` runs formatting, lint, typecheck and the unit and integration
tests. The end-to-end tests drive the real app in Chromium against a fresh
Hub (setup wizard, a dine-in service across captain, kitchen and cashier, a
Swiggy order, the day-end report and a backup):

```bash
pnpm --filter @restroos/e2e exec playwright install chromium
```

```bash
pnpm --filter @restroos/e2e test:e2e
```

To try it under load, start a new Hub with a known setup code and a high
rate limit, then run the dinner-rush script against it (details at the top
of `scripts/load-test.mjs`):

```bash
RESTRO_SETUP_CODE=LOADTEST RESTRO_RATE_LIMIT_PER_MINUTE=100000 pnpm hub --data ./load-data
```

```bash
node scripts/load-test.mjs --hub http://127.0.0.1:7400 --setup-code LOADTEST --minutes 3
```
