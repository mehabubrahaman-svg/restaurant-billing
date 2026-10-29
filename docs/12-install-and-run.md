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

## Quickest on Windows: the one-line installer

Open **PowerShell** (Start → type *PowerShell*) and paste:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/mehabubrahaman-svg/restaurant-billing/claude/nifty-shannon-ahib6j/scripts/install-windows.ps1 | iex"
```

It downloads the code and a private copy of Node.js 22 into
`%LOCALAPPDATA%\RestroOS` (no admin rights needed for those), checks for
Python 3 and the Visual Studio 2022 C++ Build Tools that the encrypted
database module is compiled with, and, after asking, installs whichever is
missing with winget (the Build Tools are about 3 GB and ask for admin). Then
it installs and builds RestroOS, adds **RestroOS Hub** to the Desktop and the
Start menu, and asks whether to start it. Starting opens a console window
(the Hub; it shows the setup code) and the browser at <http://localhost:7400>.
Run the same line again to update: the data in `%LOCALAPPDATA%\RestroOS\data`
is kept. It is tested on Windows Server 2022 by the *Windows one-line
installer* workflow.

## A. Install the desktop app

### 1. Get the installer

The installers are built by GitHub Actions, on Windows and Linux:

1. On GitHub, open the repository → **Actions** → **Desktop installers** →
   **Run workflow** (pick the branch), or push a tag such as `hub-v0.2.0`.
2. When the run finishes (about 10–15 minutes), open it and download the
   artifact: **restroos-hub-Windows** (`RestroOS Hub Setup 0.2.0.exe`) or
   **restroos-hub-Linux** (`.AppImage` and `.deb`).

The Linux job starts the AppImage and checks that the Hub answers before
it publishes the files.

### 2. Install

**Windows 10/11**: run `RestroOS Hub Setup 0.2.0.exe`. The installer isn't
code-signed yet, so Windows SmartScreen says *Windows protected your PC*:
choose **More info → Run anyway**. Choose the folder and finish; RestroOS
starts.

**Ubuntu / Debian**:

```bash
sudo apt install ./restroos-hub_0.2.0_amd64.deb
```

Then start **RestroOS Hub** from the applications menu. Or, with the
AppImage (no install):

```bash
chmod +x RestroOS-Hub-0.2.0.AppImage
```

```bash
./RestroOS-Hub-0.2.0.AppImage
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

- Scheduled reports (Reports → Scheduled) are kept in `reports/` in the data
  folder. `RESTRO_REPORTS_COPY_DIR` copies each one to a second folder too,
  for example a shared or synced folder the accountant reads.
- A backup restore restarts the Hub; `pnpm hub` starts it again by itself.
- After `git pull`, run `pnpm install` and `pnpm build` again. Database
  migrations apply on the next start, after an automatic backup.
- For Hindi/Bengali receipts as images, install Chromium for Playwright
  once: `pnpm --filter @restroos/e2e exec playwright install chromium`.
  Without it, receipts print in English.
- A Linux Hub without a screen can run as a service:
  [`deploy/linux/restroos-hub.service`](../deploy/linux/restroos-hub.service).

## Connect the other devices

Every other device uses a browser, so nothing is installed on it. iPads and
iPhones can also use the RestroOS app ([below](#ipads-and-iphones-the-restroos-app)).

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

### iPads and iPhones: the RestroOS app

Safari works the same way as Chrome above. The RestroOS app also remembers
the Hub's address and opens full screen. CSV exports go to the share sheet.

1. Get the app from GitHub: **Actions** → **iOS app** → **Run workflow**, or
   push a tag such as `ios-v0.2.0`. Download the **restroos-ios** artifact
   (about 15 minutes).
2. Install `RestroOS-unsigned.ipa` with Sideloadly or AltStore and a free
   Apple ID, or use a signed build from an Apple Developer account. The
   steps and the secrets for signing are in
   [`apps/ios/README.md`](../apps/ios/README.md).
3. Open **RestroOS** and enter the Hub's address, e.g. `192.168.1.20`.
   Allow **Local Network** access when iOS asks.
4. To pair, tap **Pair this device** on the sign-in screen and type the
   code shown under the QR code. Scanning the QR with the camera pairs
   Safari, not the app.
5. Shake the device to connect to another Hub.

## Online orders: the cloud relay

Swiggy, Zomato and other platforms reach the Hub through an aggregator
middleware and a small relay on the internet. The restaurant opens no ports:
the Hub connects out to the relay.

1. On a small cloud server, build and start the relay (Node.js 22):

   ```bash
   pnpm install && pnpm --filter @restroos/relay build
   ```

   ```bash
   RELAY_DATA_DIR=/var/lib/restroos-relay RELAY_PORT=7800 node apps/relay/dist/main.js
   ```

   Put it behind HTTPS (a reverse proxy such as Caddy or nginx), so the Hub
   connects with `wss://`. Its data is one SQLite file in `RELAY_DATA_DIR`.
2. Add the restaurant's Hub. This prints the hub id, the Hub's key, the
   webhook URL and the webhook secret, once:

   ```bash
   RELAY_DATA_DIR=/var/lib/restroos-relay node apps/relay/dist/main.js add-hub --name "Park Street" --middleware-url https://middleware.example/restroos --middleware-key <key>
   ```

3. Give the middleware the webhook URL (`https://<relay>/webhooks/<hubId>`)
   and the secret. It signs each order as described in
   [docs/05](05-api-specification.md) ("Online orders").
4. On the Hub, open **Admin → Online orders**. Enter the relay address, the
   hub id and the key, and turn it on. The status turns to *Connected*.
   **Send the menu now** pushes the menu with the Hub's own ids, which the
   platforms' orders then refer to.
5. Each platform needs an active **Admin → Sales channels** entry whose code
   matches what the middleware sends (SWIGGY, ZOMATO …).

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
