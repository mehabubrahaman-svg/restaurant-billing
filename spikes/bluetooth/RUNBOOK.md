# Bluetooth spike runbook (WP 1.7)

This spike answers one question: **can the BLE fallback channel (docs/05 §4) carry captain and KDS traffic well enough on the pilot's hardware to commit to it in Phase 1.5?** It measures latency, throughput, reconnect time and the number of concurrent links on the pilot's own Android tablets and Hub adapter. The results go into the go/no-go report in §7.

Time box: 4 days. The codec and harness are already built and tested in CI. Every step below needs real radios.

| Piece                                                                 | Where                         | Status                                                      |
| --------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| Frame codec, UUIDs, schemas, allow-list                               | `packages/contracts/src/ble/` | Production quality, unit-tested                             |
| Hub command handler (`echo`, `sink`, `source`, `stats`, `disconnect`) | `src/hub-session.ts`          | Tested end to end over a fake link (`src/loopback.test.ts`) |
| Linux GATT peripheral                                                 | `src/hub.ts` (bleno)          | **Not yet run on hardware**                                 |
| Measurement page (Chrome on Android)                                  | `web/`                        | Bundles and type-checks. **Not yet run on hardware**        |
| Concurrent-link test                                                  | BlueZ `bluetoothctl` (§5.5)   | Manual                                                      |
| Windows Hub                                                           | §8                            | Plan only                                                   |

## 1. Hardware

- **Hub:** a Linux laptop or mini-PC with **Ubuntu 24.04 or Debian 12** (BlueZ ≥ 5.66), Node 22.12+ and pnpm 10.
- **BLE adapter:** Bluetooth 5.x. If possible, test both:
  - the adapter built into the intended Hub PC (often Intel AX200/AX210/AX211), and
  - a cheap USB dongle (Realtek RTL8761B class) as the "second adapter" option.
- **Android tablets:** every tablet model the pilot uses for Captain and KDS, at least 4 units in total. Each needs a current **Chrome** (`chrome://version`), Android 10+, Bluetooth on, and Location on. On Android 12+, Chrome needs the _Nearby devices_ permission.
- A tape measure. The restaurant floor plan, with the Hub position and the farthest tables marked.
- Optional: a USB cable and `adb`, for option C in §4.

## 2. Hub setup on Linux

```sh
sudo apt install bluez bluetooth build-essential python3 libbluetooth-dev libudev-dev openssl
git clone … && cd restaurant-billing && pnpm install
```

**Native build for bleno.** The repo deliberately does not approve bleno's install scripts. On the spike machine only:

```sh
pnpm approve-builds          # tick @abandonware/bleno and @abandonware/bluetooth-hci-socket (usb is not needed)
pnpm install                 # runs the approved builds (node-gyp, compiles bluetooth-hci-socket)
```

`approve-builds` writes `pnpm.onlyBuiltDependencies` in the root `package.json`. **Do not commit that change** unless the team decides to keep bleno.

If the build is skipped, build it by hand:

```sh
cd "$(ls -d node_modules/.pnpm/@abandonware+bluetooth-hci-socket@*/node_modules/@abandonware/bluetooth-hci-socket)"
npx node-gyp rebuild && cd -
```

**Give bleno the adapter.** bleno talks raw HCI, so it cannot share the adapter with `bluetoothd`:

```sh
sudo systemctl stop bluetooth            # restart it afterwards (and for §5.5)
sudo rfkill unblock bluetooth
sudo btmgmt -i hci0 power on             # or: sudo hciconfig hci0 up
```

To keep `bluetoothd` on the built-in adapter, put the spike on a second dongle with `BLENO_HCI_DEVICE_ID=1`.

**Permissions.** Either run the Hub as root (`sudo -E env "PATH=$PATH" pnpm …`), or grant raw-socket capabilities to Node for the duration of the spike:

```sh
sudo setcap cap_net_raw,cap_net_admin+eip "$(readlink -f "$(which node)")"
# afterwards: sudo setcap -r "$(readlink -f "$(which node)")"
```

## 3. Run the Hub

```sh
pnpm --filter @restroos/spike-bluetooth hub -- --name "RestroOS Spike"
```

Expected log: `adapter state: poweredOn`, then `advertising "RestroOS Spike" with service c8ef0001-…`, and a `pairing nonce rotated` line every 60 s. For each tablet the Hub logs:

- `central connected: <address>`
- `ATT MTU negotiated: <n>`. **Record this n for every tablet model.** If no MTU line appears, the link stays at MTU 23 (15-byte frames). That is itself a result.
- `evt-out subscribed (max notification value …)`
- on disconnect, the link's counters (frames, bytes, frame errors).

`--max-mtu` (default 517) raises bleno's built-in cap of 256 by setting a private field. If the log prints `could not raise bleno maxMtu`, the MTU tops out at 256.

**Known limit:** bleno serves **one central at a time**. It keeps a single connection handle and only re-advertises after that central disconnects. Use it for everything except the link count, which §5.5 measures with BlueZ.

## 4. Serve the measurement page to the tablets

Web Bluetooth only works in a **secure context**. A plain `http://192.168.x.x` page cannot use it. Three options:

| Option                                     | How                                                                                                                                                                                                                                                                                                     | When to use it                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **A. HTTPS with a spike CA (recommended)** | `pnpm --filter @restroos/spike-bluetooth web -- --https` serves on `:8443` and prints the URLs. On each tablet, open `https://<hub-ip>:8443/ca.crt`, then install it under _Settings → Security → Encryption & credentials → Install a certificate → CA certificate_, and open `https://<hub-ip>:8443/` | Default. It rehearses the production design (docs/01 §6.1: tablets trust the Hub's local CA), and nothing has to be retyped per tablet |
| B. Insecure-origin flag                    | `pnpm --filter @restroos/spike-bluetooth web` serves HTTP on `:8080`. On the tablet, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://<hub-ip>:8080`, enable the flag and relaunch Chrome                                                                                   | When you cannot install a CA (managed devices)                                                                                         |
| C. `adb reverse`                           | Serve over HTTP, run `adb reverse tcp:8080 tcp:8080` and open `http://localhost:8080`. Chrome treats localhost as secure                                                                                                                                                                                | One USB-attached tablet at a time                                                                                                      |

Why A is the default: clicking through a self-signed certificate warning is not reliable for Web Bluetooth, because Chrome restricts powerful features on pages with certificate errors. A real, trusted CA has no such caveat and matches production. The certificates are generated with the system `openssl` into `~/.cache/restroos-spike-certs`, or `$RESTROOS_SPIKE_CERT_DIR`. The CA is reused across runs. The server certificate is reissued on every start with the current IPs in its SAN. **Delete the CA from the tablets after the spike.**

The page shows _Ready_ when Web Bluetooth is usable. Otherwise it tells you why: no secure context, no Web Bluetooth, or Bluetooth off.

## 5. What to measure

Before you start, enter a **tablet label** (model, unit number and distance, for example `Lenovo M10 #2, 3 m`). Keep **cmd-in writes** on _with response_ unless a step says otherwise. Tap **Connect to Hub…** and choose _RestroOS Spike_ in Chrome's chooser. After each block, tap **Copy as JSON** and paste the report into the results file (§7).

### 5.1 Latency (per tablet model, 1–2 m from the Hub)

1. **Echo ×100 (small)** measures the bare round trip.
2. **Echo ×100 (KOT-sized)**. The request is a realistic 4-item KOT body of about 600 B JSON, which takes about 42 frames at MTU 23 and 3 frames at MTU 247. This is the number the go/no-go threshold uses.
3. Repeat step 2 with **cmd-in writes: without response**. If it is much faster and has 0 failures, Phase 1.5 should use it.
4. If the Hub logged MTU 23, set **MTU override** to 23 and confirm that nothing breaks.

### 5.2 Throughput

**Upload 1/10/100 KB** and **Download 1/10/100 KB**. The data is uncompressed and incompressible, so this measures the raw link. Run each once with _with response_ and once with _without response_. The fallback only needs a few KB per KOT, so these numbers are headroom, not a target.

### 5.3 Reconnect

- **Reconnect ×5 (Hub drops)** is the main number: the Hub drops the link, as when it restarts or loses the link. It measures the time from disconnect until an echo succeeds on the new link, including rediscovery and re-subscription.
- **Reconnect ×5 (tablet drops)** is for information.
- **Manual walk-out test.** Turn on _keep-alive_, walk away until the link drops (the log shows `link disconnected`), walk back, and tap **Connect** again. The page does not auto-reconnect after a real link loss. Write down the distance at which the link dropped.

### 5.4 Range and environment

At the farthest table and in the kitchen (through the pass or a wall), run **Echo ×100 (KOT-sized)** again. Do it once with the restaurant's Wi-Fi under normal load: 2.4 GHz Wi-Fi shares the band with BLE. Also note whether Chrome keeps the link while the tablet's screen is off or the tab is in the background. If it does not, that is expected, but it confirms that the fallback must live in the Android app.

### 5.5 Concurrent links (BlueZ, not bleno)

Stop the spike Hub, then start `bluetoothd` again (`sudo systemctl start bluetooth`). Serve a minimal copy of the service with BlueZ's own GATT server, which accepts multiple centrals:

```text
$ bluetoothctl
[bluetooth]# menu gatt
[bluetooth]# register-service c8ef0001-26b7-4e9e-97bd-541662ebe8e4        (Primary: yes)
[bluetooth]# register-characteristic c8ef0002-26b7-4e9e-97bd-541662ebe8e4 read   (value: 0x7b 0x7d)
[bluetooth]# register-application
[bluetooth]# back
[bluetooth]# menu advertise
[bluetooth]# uuids c8ef0001-26b7-4e9e-97bd-541662ebe8e4
[bluetooth]# name RestroOS-Links
[bluetooth]# back
[bluetooth]# advertise on
```

The prompts differ slightly between BlueZ versions.

Connect tablets one at a time. The page shows _discovery only_ and reads `hub-info` instead of running echo. Turn on **keep-alive** on each tablet. After each new tablet, check the count:

```sh
bluetoothctl devices Connected     # BlueZ ≥ 5.65; or: sudo btmgmt con / hcitool con
```

If the next tablet cannot find the Hub, run `advertise off` and then `advertise on`. Some controllers stop advertising after a connection. Keep going until a connection fails or an earlier one drops. Then **hold the maximum stable count for 10 minutes**: keep-alive failures must stay at 0 on every tablet. Do this for each adapter.

This measures the link count, not throughput when every link is busy. If the count passes, the follow-up is a BlueZ D-Bus GATT server for the Hub, which serves many centrals and coexists with `bluetoothd`. Then rerun §5.1–5.2 with 4 tablets busy at once.

## 6. Go/no-go thresholds (defaults: confirm with the product owner before measuring)

| #   | Metric (worst tablet model)                                         | Must | Default threshold                                                                        |
| --- | ------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| T1  | KOT-sized echo RTT p95, 1–2 m                                       | yes  | **< 1 000 ms** (p50 < 300 ms)                                                            |
| T2  | KOT-sized echo RTT p95 at the farthest table and in the kitchen     | yes  | < 1 500 ms, 0 failures out of 100                                                        |
| T3  | Concurrent stable links per adapter (10 min, 0 keep-alive failures) | yes  | **≥ 4** (target 6: 2 KDS + 4 captains)                                                   |
| T4  | Reconnect after a Hub-side drop, until usable, p95                  | yes  | **< 5 s**                                                                                |
| T5  | `GAP` / `TIMEOUT` frame errors across all runs                      | yes  | 0 (any recurring GAP means notifications are being lost and a per-message ack is needed) |
| T6  | Download throughput, 10 KB                                          | no   | ≥ 5 KB/s                                                                                 |
| T7  | Upload throughput, 10 KB                                            | no   | ≥ 3 KB/s                                                                                 |
| T8  | Negotiated MTU                                                      | no   | ≥ 185 (MTU 23 still works, just ~10× more frames)                                        |

- **Go:** T1–T5 pass on every pilot tablet model and on the intended Hub adapter.
- **Conditional go:** only T3 fails. Budget a second adapter or a BLE relay near the dining area (docs/01 §6.3) and retest with it.
- **No-go** for the fallback channel: T1, T2, T4 or T5 fail. Discovery and pairing over BLE are unaffected, and Wi-Fi stays the only path.

## 7. Results template

Copy this into `spikes/bluetooth/results/<date>-<site>.md` and attach the JSON reports from the page.

```markdown
# BLE spike results: <site>, <date>, <who>

Hub: <PC model>, <OS + BlueZ version>, adapter <model / chipset>, bleno <ok/issues>
Wi-Fi during test: <SSID, 2.4/5 GHz, load>

| Tablet (model, Android, Chrome) | MTU | Echo small p50/p95 | Echo KOT p50/p95 (with resp) | Echo KOT p95 (w/o resp) | Up 10 KB KB/s | Down 10 KB KB/s | Reconnect Hub-drop p50/p95 | Frame errors |
| ------------------------------- | --- | ------------------ | ---------------------------- | ----------------------- | ------------- | --------------- | -------------------------- | ------------ |
|                                 |     |                    |                              |                         |               |                 |                            |              |

| Location (distance, obstacles) | Tablet | Echo KOT p95 | Failures | Link dropped at |
| ------------------------------ | ------ | ------------ | -------- | --------------- |
|                                |        |              |          |                 |

| Adapter | Max stable links (10 min) | First failure mode |
| ------- | ------------------------- | ------------------ |
|         |                           |                    |

Thresholds: T1 ☐ T2 ☐ T3 ☐ T4 ☐ T5 ☐ T6 ☐ T7 ☐ T8 ☐ → **Go / Conditional / No-go**
Notes (screen-off behaviour, MTU, surprises):
```

## 8. Windows Hub plan (follow-up: it cannot be prototyped on Linux)

The Windows Hub needs a BLE **peripheral** (GATT server). Node has no maintained binding for that, so the plan is a small native **bridge** process. It moves frames and link events only. The codec, `HubSession` and every rule stay in TypeScript and are shared with Linux.

- **Bridge.** A .NET 8 console app (`net8.0-windows10.0.19041.0`) built on WinRT `Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProvider`. It creates the service with the same UUIDs and calls `StartAdvertising` with `IsConnectable` and `IsDiscoverable` set to true. It serves `hub-info` and `pairing` from values the Hub pushes to it. `cmd-in` writes are forwarded with a per-client id. `evt-out` uses `GattLocalCharacteristic.NotifyValueAsync(buffer, subscribedClient)`, which **can address one central**, unlike BlueZ's D-Bus API. `GattSubscribedClient.MaxNotificationSize` gives MTU − 3 for each client.
- **Hub ↔ bridge IPC.** A local WebSocket or named pipe, with messages `{linkId, frame}`, `connected`, `disconnected`, `mtu` and `read-request`. The Node side creates one `HubSession` per `linkId`, as `hub.ts` does for bleno. A BlueZ D-Bus bridge for Linux can use the same IPC, which would replace bleno and lift its one-central limit.
- **Adapter requirements.**
  - Windows 10 2004+ (docs/01 §6.3).
  - The adapter must report **`BluetoothAdapter.IsPeripheralRoleSupported == true`**. The setup wizard checks this. Many older or generic dongles report false under the Windows stack.
  - `IsLowEnergySupported`, and ideally `AreLowEnergySecureConnectionsSupported`.
  - The advertised local name is the PC's name, which the app cannot set.
- **Spike steps (about 2 days).**
  1. Write a 30-line C# probe that prints `IsPeripheralRoleSupported` and `MaxAdvertisementDataLength` on each candidate Hub PC and dongle.
  2. Build the bridge with `echo` support only.
  3. Point the measurement page at it unchanged: the UUIDs and frames are identical.
  4. Rerun §5.1–5.5. On Windows, §5.5 can use the bridge itself.

## 9. Known gaps in this harness

- bleno: one central at a time, raw HCI, and `bluetoothd` must be stopped. It is fine for a spike and **not a production option**. Production Linux should use the BlueZ D-Bus GATT API behind the bridge IPC in §8.
- BlueZ's D-Bus API sends notifications to every subscribed central. The protocol already copes: msgIds on `evt-out` are Hub-wide, and tablets ignore responses they did not request. The cost is airtime on every link, which should be measured once a D-Bus bridge exists.
- The page's MTU comes from the Hub, through `hub-info.mtu`, because Web Bluetooth does not expose it. bleno reports one global MTU, which is correct only while one central is connected.
- WP 1.7 also lists a **Capacitor Android prototype**. It is not part of this harness. It reuses `RpcClient` with a native BLE plugin and is the place to verify background and screen-off behaviour, where Chrome cannot hold the link.
- Allowed API routes return `501` in the spike, because no application layer is wired. The latency of a real KOT (DB write plus KDS fan-out) has to be added to T1 separately.
