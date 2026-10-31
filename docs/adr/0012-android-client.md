# ADR 0012 — An Android app: a native shell that also prints over Bluetooth

- Status: Accepted
- Date: 2026-10-31

## Context
Most Indian restaurants run Android tablets and phones, not iPads. Chrome
on Android runs the web app, but it can't reach a Bluetooth printer
paired with the tablet. Web Bluetooth works only with BLE, needs a tap
each time, and has no classic SPP, which most cheap 58/80 mm thermal
printers use. ADR 0006 left these printers as `409 PRINTER_ON_DEVICE`.
The owner wants an Android client (not the Hub) that feels like a native
app and prints to Bluetooth printers.

## Decision
1. `apps/android` is a Kotlin app with one `Activity` and one `WebView` on
   the Hub's address, the same shape as the iOS app (ADR 0011). It has no
   library dependencies: the pure logic (address parsing, chunking, JS
   quoting) is a plain Kotlin `core` module with JVM unit tests. minSdk 26
   (Android 8).
2. The app keeps the Hub's address, checks `GET /api/v1/health`, keeps the
   screen on, and can pin itself (screen pinning) as a kiosk. Links to
   other sites open outside the app. Uploads use the system file picker.
   Downloads go to Downloads.
3. **Bluetooth printing goes through the Hub's queue, not the page.** A
   printer with connection `BLUETOOTH` (classic SPP) or `BLE`, an address
   (its MAC) and a `deviceId` belongs to that tablet. When the Hub prints a
   KOT, bill or report on it, it renders the ESC/POS bytes as usual and
   queues them in `device_print_jobs` (migration 0020) instead of sending
   them. The tablet's web app polls `GET /devices/me/print-jobs` every 3 s,
   hands each job to the app through `window.RestroAndroid.print`, and
   reports `POST /devices/me/print-jobs/{id}/result`. Jobs older than 10
   minutes expire, so a tablet that comes back late doesn't print stale
   KOTs.
   - So KOTs print on a kitchen tablet's printer even when nobody touches
     it, and the Hub stays the one place that renders slips (Hindi and
     Bengali raster included).
   - Printer choice prefers the requesting tablet's own printer, then the
     Hub's, then another tablet's.
4. The app prints classic printers over RFCOMM (SPP UUID, then the insecure
   socket, then channel 1), in 512-byte writes, and holds the socket open
   until the data has drained. It prints BLE printers by raising the MTU and
   writing to a known printer characteristic (or the first writable one).
   It only uses printers already paired in Android settings, so it needs
   "Nearby devices" (`BLUETOOTH_CONNECT`) and never scans or needs location.
5. Admin → Printers on the tablet lists the paired printers and fills in
   the address, connection and "Printed by: this tablet".
6. `.github/workflows/android.yml` runs the unit tests and Android lint,
   builds a debug APK and a release APK (signed when the keystore secrets
   are set), and smoke-tests the app in an emulator against a real Hub.

## Consequences
- A tablet prints only while the app is open on it. KOTs fired while it is
  closed wait up to 10 minutes, then expire, and the kitchen sees them on the
  KDS or reprints them.
- Polling costs one small request every 3 s per paired Android tablet, which
  is fine on a LAN. A WebSocket push can replace it later.
- Without a release keystore, each CI run's debug APK has a different key,
  so updating means uninstalling first, which unpairs the tablet. Set the
  signing secrets before rolling out.
