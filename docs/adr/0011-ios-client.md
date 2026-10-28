# ADR 0011 — An iPad and iPhone app: a native shell around the Hub's web app

- Status: Accepted
- Date: 2026-10-28

## Context
ADR 0006 supports iPads over Wi-Fi only, in Safari. The owner wants an app
that installs on iPads and iPhones, built on GitHub Actions like the Windows
installer. iOS can't run the Hub (no Node, no background server), so the app
is a client only. Safari "Add to Home Screen" works but loses the Hub's
address when the site data is cleared, and can't share a CSV export to Files.

## Decision
1. `apps/ios` is a SwiftUI app with one full-screen `WKWebView` on the
   Hub's own address. It loads the web app the Hub serves, so the Hub and the
   tablets never disagree on a version, and the web app's relative API paths,
   same-origin refresh cookie and WebSocket keep working as they are.
2. The app keeps only the Hub's address. On first run it asks for it and
   checks `GET /api/v1/health`. Shaking the device or the "can't reach the
   Hub" screen lets staff pick another Hub.
3. Links to other sites open in Safari. JavaScript alerts and confirms are
   native dialogs. File downloads go to the share sheet (Files, Mail,
   AirDrop).
4. Plain HTTP on port 7400 is allowed (App Transport Security off), because
   a restaurant Hub has a LAN address and a private CA, not a public
   certificate. HTTPS on 7443 works once the Hub's CA is installed and
   trusted on the device.
5. We chose a Swift shell over Capacitor. It is about 400 lines with no npm
   or CocoaPods dependencies, and the project is generated with XcodeGen in
   CI, so no Xcode project is kept in the repo.
6. `.github/workflows/ios.yml` builds on macOS. Every run makes an unsigned
   `.ipa` and smoke-tests the app in an iPad simulator against a real Hub.
   With signing secrets it also exports a signed `.ipa` (ad hoc, development,
   enterprise or App Store, read from the provisioning profile). With an App
   Store Connect key it uploads the build to TestFlight.

## Consequences
- An installable iOS app needs an Apple Developer account ($99 a year) for
  ad hoc, TestFlight or App Store builds. Without one, the unsigned `.ipa`
  can be sideloaded with a free Apple ID, but it must be re-signed every
  7 days.
- There is still no Bluetooth on iOS: printers stay on the Hub (ADR 0006).
- macOS runner minutes cost ten times Linux minutes on private
  repositories.
