# ADR 0006 — Bluetooth for discovery, Wi-Fi fallback and peripherals

- Status: Accepted (subject to the Sprint 1 spike)
- Date: 2026-10-28

## Context
The product owner wants Bluetooth used beyond printers. Browsers support Bluetooth unevenly: Chrome on Android/desktop has Web Bluetooth, but iPad/iPhone browsers have none. BLE is short-range and slow.

## Decision
1. **Discovery & pairing**: the Hub runs a BLE GATT server (Linux BlueZ, Windows WinRT bridge) that advertises its LAN URLs, CA fingerprint and a rotating pairing nonce.
2. **Wi-Fi fallback channel**: a GATT command/notify channel carries the same API contracts (allow-listed routes only, same auth/RBAC, idempotency keys) when Wi-Fi is down.
3. **Peripherals**: Classic and BLE printers, scanners, scales and pagers, on the Hub or on individual tablets.
4. Captain and KDS tablets are **Android**. Phase 1 uses Chrome (Web Bluetooth) for pairing and peripherals. Phase 1.5 ships a **Capacitor Android app** (same React build) for the automatic Wi-Fi fallback and KDS kiosk mode. iPads are supported over Wi-Fi only.

## Consequences
- Adds an Android app build and two OS-specific BLE bridges (Hub) to maintain. No iOS app is needed.
- A Sprint 1 spike must confirm throughput and concurrent-connection limits on target adapters and tablets before the fallback channel is committed (Phase 1.5).
