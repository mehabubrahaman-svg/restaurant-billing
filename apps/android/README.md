# RestroOS for Android

A small native app for Android tablets and phones. It opens the RestroOS
Hub's web app full screen and prints to Bluetooth printers paired with the
tablet ([ADR 0012](../../docs/adr/0012-android-client.md)). It is a client
only: the Hub still runs on the restaurant's PC.

- `core/` is plain Kotlin (Hub address parsing, Bluetooth chunking) with
  unit tests.
- `app/` is the app: `MainActivity` (connect screen and `WebView`),
  `WebBridge` (`window.RestroAndroid` for the web app) and
  `BluetoothPrinters` (classic SPP and BLE).
- The web side is `apps/web/src/lib/android-bridge.ts` and
  `apps/web/src/features/devices/device-print-agent.ts`.

## Build

The **Android app** workflow (`.github/workflows/android.yml`) builds it on
every push that changes `apps/android`, on a tag such as `android-v0.3.0`,
or by hand from the Actions tab (**Android app** → **Run workflow**). The
**restroos-android** artifact contains:

| File                    | What it is                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `RestroOS.apk`          | The release app, signed with your key (when the secrets are set).  |
| `RestroOS-unsigned.apk` | The release app, unsigned (when they aren't). It won't install.    |
| `RestroOS-debug.apk`    | The app signed with a throwaway debug key. Installs on any device. |
| `screenshots/`          | The app in an emulator, connected to a fresh Hub.                  |

To build locally you need JDK 17 and the Android SDK (Android Studio has
both). Open `apps/android` in Android Studio, or run:

```sh
cd apps/android
./gradlew :core:test :app:assembleDebug
```

### Signing

Without a key of your own, every CI run is signed with a different debug
key, so Android refuses to update the installed app. You'd have to
uninstall it first, which also unpairs the tablet. Make one key and keep it
safe:

```sh
keytool -genkeypair -v -keystore restroos.jks -alias restroos -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 restroos.jks
```

Then add these repository secrets (**Settings → Secrets and variables →
Actions**):

| Secret                      | Value                         |
| --------------------------- | ----------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | The base64 of `restroos.jks`. |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password.        |
| `ANDROID_KEY_ALIAS`         | `restroos` (the alias above). |
| `ANDROID_KEY_PASSWORD`      | The key password.             |

## Install

1. Copy `RestroOS.apk` (or `RestroOS-debug.apk`) to the tablet, or download
   it there, and open it. Allow **Install unknown apps** for the browser or
   file manager when asked.
2. Open **RestroOS** and enter the Hub's address, e.g. `192.168.1.20`. Tick
   **Pin the app** for a counter or kitchen tablet that should only run
   RestroOS. To unpin, hold **Back** and **Overview** together.
3. Pair it like any device: on the sign-in screen tap **Pair this device**
   and type the code from Admin → Devices on the Hub.

## Bluetooth printers

1. Turn the printer on and pair it in Android's **Settings → Bluetooth**
   (the PIN is usually `0000` or `1234`).
2. In RestroOS on that tablet, go to **Admin → Printers → Add printer**. Choose
   **Bluetooth** (or **Bluetooth LE**), tap **Choose a printer paired with
   this tablet** and pick it. **Printed by** becomes this tablet. For a
   kitchen printer, set **Used for: KOT** and its **Kitchen station**.
3. Allow **Nearby devices** when Android asks, then **Print test page**.

The Hub queues that printer's KOTs, bills and reports for the tablet. The
app prints them while it is open, on any screen. A ticket the tablet can't
print shows a red message and the Hub marks it failed. Tickets older than 10
minutes are dropped. Keep a kitchen tablet on charge with the app open.
