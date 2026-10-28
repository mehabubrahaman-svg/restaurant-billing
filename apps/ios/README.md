# RestroOS for iPad and iPhone

A small native app that opens the RestroOS Hub's web app full screen
([ADR 0011](../../docs/adr/0011-ios-client.md)). It is a client only: the Hub
still runs on the restaurant's PC. The app remembers the Hub's address, so
staff don't need to type a URL.

- `project.yml` is the [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec.
  The Xcode project is generated from it and isn't kept in the repo.
- `RestroOS/Sources` holds the app (SwiftUI and `WKWebView`).
- `RestroOS/Resources` holds the icon, the accent colour and the strings in
  English, Hindi and Bengali.

## Build

The **iOS app** workflow (`.github/workflows/ios.yml`) builds the app on
macOS. It runs on every push that changes `apps/ios`, on a tag such as
`ios-v0.2.0`, or by hand from the Actions tab (**iOS app** → **Run
workflow**). The **restroos-ios** artifact contains:

| File                                                                   | What it is                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `RestroOS-unsigned.ipa`                                                | The device app, unsigned. Sideload it (below).          |
| `RestroOS-ad-hoc.ipa` (or `-development`, `-app-store`, `-enterprise`) | The signed app, when the signing secrets are set.       |
| `RestroOS-simulator.zip`                                               | The app for the iOS Simulator on a Mac.                 |
| `screenshots/`                                                         | The app in an iPad simulator, connected to a fresh Hub. |

To build on a Mac instead:

```sh
brew install xcodegen
cd apps/ios && xcodegen generate && open RestroOS.xcodeproj
```

Choose your team under **Signing & Capabilities** and run it on a device.

## Install on an iPad or iPhone

**Without an Apple Developer account.** Sideload `RestroOS-unsigned.ipa`
with [Sideloadly](https://sideloadly.io) or [AltStore](https://altstore.io)
on a Windows PC or a Mac, signed in with any Apple ID:

1. Connect the iPad by USB, open Sideloadly, drop in the `.ipa`, enter the
   Apple ID and press **Start**.
2. On the iPad, go to **Settings → General → VPN & Device Management** and
   trust the developer (your Apple ID).
3. On iOS 16 and later, turn on **Settings → Privacy & Security → Developer
   Mode** and restart when asked.

A free Apple ID's signature lasts 7 days, so sideload the app again each
week. AltStore can do that automatically over Wi-Fi.

**With an Apple Developer account** ($99 a year), add these repository
secrets (**Settings → Secrets and variables → Actions**). The next run then
signs the app.

| Secret                                      | Value                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IOS_CERTIFICATE_P12`                       | The Apple Distribution (or Development) certificate with its private key, exported from Keychain Access as `.p12`, then base64-encoded (`base64 -i cert.p12`). |
| `IOS_CERTIFICATE_PASSWORD`                  | The `.p12` password.                                                                                                                                           |
| `IOS_PROVISIONING_PROFILE`                  | The provisioning profile for the bundle id `app.restroos.client` (or a wildcard), base64-encoded.                                                              |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | Optional. An App Store Connect API key (the `.p8` base64-encoded), to upload App Store builds to TestFlight.                                                   |

The profile decides what you get:

- **Ad hoc**: installs on the iPads listed in the profile, from the `.ipa`
  (Apple Configurator, or a link from an MDM).
- **App Store**: goes to TestFlight, so staff install it from the TestFlight
  app.
- **Enterprise**: installs on any device in the organisation.

## Use

1. Put the iPad on the restaurant's Wi-Fi and open **RestroOS**.
2. Enter the Hub's address, for example `192.168.1.20` or `restro.local`
   (port 7400 is the default). The Hub PC shows its address when it starts.
3. The Hub's web app opens: sign in, or pair the device under **Admin →
   Devices**.
4. To use another Hub, shake the device, or tap **Use another Hub** when the
   Hub can't be reached.

Allow **Local Network** access when iOS asks. Without it, the app can't
reach the Hub. HTTPS (`https://…:7443`) works once the Hub's certificate is
installed and trusted on the iPad (**Settings → General → About →
Certificate Trust Settings**). Plain HTTP on port 7400 works without it.
