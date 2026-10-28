# 09 — Detailed Implementation Plan (Phase 1: Core POS)

Each work package (WP) is a reviewable PR of ≤ ~800 lines with tests. WPs are ordered by dependency, and WPs on the same row can run in parallel.

## Sprint 1 — Foundation (2 wks)

> **Status (2026-10-28)**: delivered except where noted. **Deferred**: Husky pre-commit hooks (CI runs the same checks) and Storybook (component tests cover the UI kit for now). Drizzle schemas move to Sprint 2 with the first aggregate repositories, since Sprint 1 writes only platform tables. The Bluetooth spike (1.7) has its harness built and unit-tested. **The measurements themselves need the pilot's Android tablets and a Linux/Windows Hub with a BLE adapter**; see `spikes/bluetooth/RUNBOOK.md`.

| WP | Deliverable | Acceptance |
|---|---|---|
| 1.1 | Monorepo: pnpm, Turborepo, TS strict, ESLint (+boundaries), Prettier, Vitest, Husky, CI (lint, typecheck, test, build) | `pnpm ci` green on Windows + Linux runners |
| 1.2 | `packages/domain/shared`: `Money`, `Rate`, `Quantity`, `BusinessDate`, `Result`, `Entity`, `AggregateRoot`, `DomainEvent`, UUIDv7 | Property-based tests on Money rounding/allocation |
| 1.3 | `infrastructure/db`: SQLCipher connection, pragmas, migrator (runs `database/migrations/*.sql`, records checksum, pre-migration backup), Drizzle schema, `UnitOfWork` (`BEGIN IMMEDIATE`, version checks, outbox + audit writer) | Migration idempotent; concurrent writer test; delete-trigger tests |
| 1.4 | `apps/server` bootstrap: Fastify, awilix DI, config, pino logging, problem+json errors, `/health`, idempotency-key store, rate limit | Integration test harness with in-memory encrypted DB |
| 1.5 | `apps/web` shell + `packages/ui`: Vite, Tailwind 4, shadcn, theme tokens (light/dark/high-contrast), layout, connection pill, router per portal | Storybook for core widgets |
| 1.6 | i18n foundation: i18next + ICU, `en-IN`/`hi-IN`/`bn-IN` catalogues, bundled Noto fonts, lint rule banning hard-coded UI strings, pseudo-locale for testing | Every screen renders in all 3 locales without overflow at 768 px |
| 1.7 | **Bluetooth spike** (time-boxed 4 days): BLE GATT server on Linux (BlueZ) and Windows (WinRT bridge); clients: Chrome on the pilot's Android tablets + a Capacitor Android prototype; measure throughput, latency, max concurrent links, reconnect time | Go/no-go report feeding Phase 1.5 |

## Sprint 2 — Identity & setup (2 wks)

> **Status (2026-10-28)**: delivered. Backend: 54 server tests. Web: login (password + PIN pad), setup wizard, permission-aware UI, manager-approval dialog, staff/roles/branch/taxes/charges/printers/audit screens, change password, all in English/Hindi/Bengali (108 web + 28 UI tests), verified against a real Hub. Open: the admin tab strip scrolls sideways at 768 px; Hindi/Bengali text awaits native-speaker review. Decisions made: hand-written SQL repositories instead of Drizzle (ADR 0010); sign-in bookkeeping doesn't bump the user's edit version; refresh cookie is not `Secure` until LAN TLS pairing (Sprint 3), with a config switch `RESTRO_SECURE_COOKIES`.

| WP | Deliverable |
|---|---|
| 2.1 | Auth: login, PIN login, refresh rotation with family revoke, lockout, `/auth/approve` manager override, JWT (jose, EdDSA) |
| 2.2 | RBAC: permission guard `requires()` preHandler, role templates (Admin, Manager, Cashier, Captain, Kitchen, Inventory, Accountant), UI `<Can permission>` |
| 2.3 | First-run setup wizard: organisation, branch, **state (wave 1 only) → state pack** (GST groups, liquor VAT groups or liquor disabled, separate liquor bill default, languages), GSTIN / VAT TIN / excise licence, admin user, backup passphrase |
| 2.4 | Users & roles admin UI · Settings UI (taxes, service charge, printers, receipt template) |
| 2.5 | Audit log writer (hash chain) + viewer; nightly chain verification job |

## Sprint 3 — Menu & floor (1.5 wks)

> **Status (2026-10-28)**: delivered. Backend: 73 server tests, verified on a real Hub over HTTP and HTTPS. Web: menu editor (items, variants, add-ons, stations, Hindi/Bengali names), CSV import with dry run, kitchen availability screen, drag-and-drop floor editor with conflict recovery, table QR cards and A4 print sheet, captain floor view, device pairing (QR + countdown + CA fingerprint, `/pair` page) and peripherals, PIN pad shown only on paired devices (153 web + 30 UI tests), checked against the real Hub in all three languages at 768 and 1366 px. Unpairing a device also ends every session on it. Built: catalog commands and queries with branch-level "86", menu snapshot with ETag/304, all-or-nothing CSV import with dry run; floor areas, tables, grid layout save, manual table state machine, rotating table QR; device pairing with one-time codes, device tokens, a local CA with an auto-renewing server certificate, HTTPS on 7443 beside HTTP on 7400, mDNS advertising (`_restroos._tcp`, `restro.local`), PIN sign-in restricted to paired devices, device and peripheral registry. **Deferred: BLE advertising and GATT hub-info/pairing** until the Bluetooth spike's go/no-go on the pilot's hardware (WP 1.7), and because a pairing nonce readable by anyone in radio range needs a confirm-on-Hub step first (docs/05 §4). Discovery uses mDNS plus the pairing QR meanwhile. Guest QR pages (`/qr/<token>`) arrive with QR ordering in Phase 5; the QR codes can already be printed. **Open:** CSV import errors come back in English only (they need per-row error codes to be translated); touch dragging and the 500-item availability list are untested on the pilot tablets; table labels are unique per branch, not per area (by design, so a captain's "T4" is unambiguous).

| WP | Deliverable |
|---|---|
| 3.1 | Catalog commands/queries: categories, items, variants, addon groups, kitchen stations, availability toggle; menu snapshot endpoint with ETag |
| 3.2 | Admin menu editor UI (bulk CSV import of menu) |
| 3.3 | Floor areas + tables, drag-and-drop layout editor, table state machine, QR token generation |
| 3.4 | Device pairing (mDNS advertise, **BLE advertise + GATT hub-info/pairing**, pairing QR, local CA), device registry, peripherals registry (BT/USB printers, scanners) |

## Sprint 4 — Ordering & Kitchen (2 wks)

> **Status (2026-10-28)**: backend delivered: `Order` and `Kot` aggregates (118 domain tests), order commands with table coupling, move/merge, cancel with manager approval once the kitchen has an item, FireKot split by station, KDS commands, metrics and the token board, and the WebSocket gateway with permission-based topics, coalescing, resume/replay and the KOT delay watcher (92 server tests; verified on a real Hub over HTTPS/WSS). Web: captain floor with live order tiles, order pad with options sheet, quick notes and batched taps, send to kitchen, ready alerts, cancel with manager approval, move/merge; KDS board with station filter, timing colours, item bump, chef assignment, chime and metrics; token display for a paired TV with nobody signed in; WebSocket client with resume/resync and re-auth; offline command queue in IndexedDB replayed in order with the same Idempotency-Keys (207 web + 32 UI tests, axe checks). Verified end to end on the real Hub, including offline replay and a page reload while the Hub was down. Screenshots: `docs/screenshots/sprint-4/`. **Open:** a tablet can't open a new order while offline (only changes to existing orders queue; needs client-generated order ids); no service worker yet, so a tablet reloaded while the Hub is down shows "Cannot reach the Hub" until it returns (its queue is safe); quick notes go out in the captain's UI language; the "sent" toast briefly covers the order title on a 768 px pad; not yet tried on the pilot's Android tablets or a 1080p kitchen TV; real token-refresh re-auth, `resync`, merge and chef assignment were tested automatically but not by hand on the Hub.

| WP | Deliverable |
|---|---|
| 4.1 | `Order` aggregate: open, add/update/cancel items, totals, transfer/merge tables. Commands + tests |
| 4.2 | `Kot` aggregate + `FireKot` (split by station), state machine NEW→ACCEPTED→COOKING→READY→SERVED, chef assignment, `kot_status_events` |
| 4.3 | WebSocket gateway: auth, rooms, typed messages, `resume` with lastSeq |
| 4.4 | Captain portal: floor view, order pad, item sheet, quick search, send to kitchen, ready notifications; PWA + IndexedDB offline queue |
| 4.5 | KDS portal: 4-column board, sounds, delay colouring (`jobs/kot-delay-watcher`), bump, assign chef, metrics strip; Token display |

## Sprint 5 — Billing & go-live hardening (2.5 wks)

> **Status (2026-10-28)**: delivered in two halves. **5A (WP 5.1–5.4)**: backend done: tax engine (per-line GST/VAT, inclusive and exclusive prices, bill discounts spread before tax, taxed service charge, LIQ split, aggregator GST-by-operator, cash rounding; hand-computed table tests), gapless INV/LIQ/CN numbering, discounts with role limit and approval, coupons, complimentary, split payments with keyed card/UPI references, cash shifts with X/Z and per-terminal variances, cancellation and line/amount credit notes. Web: POS counter with order queue, bill preview (INV + LIQ), discount/coupon/complimentary/customer options with approval, payment pad with split tenders, change and quick cash, shift prompt, bills history and invoice detail, refund by line or amount, cancel with approval, cash shift X report → count by denomination → variance confirm → Z report, coupons admin, F-key shortcuts (228 web + 32 UI tests, axe checks); verified on a real Hub with a cashier and a manager approving. Screenshots: `docs/screenshots/sprint-5a/`. **Open:** the refund dialog estimates the amount from line totals (a refund preview route would make it exact); no "+ New takeaway" button on the counter yet; the web finds credit notes through the day list and should switch to `GET /invoices/{id}/credit-notes` (done in 5B). **5B (WP 5.5–5.10)**: delivered. Printing: ESC/POS text and raster (Hindi/Bengali drawn by Chromium) for bills, KOTs per station, X/Z and day-end slips over TCP 9100, device file or `lp`; reprints marked DUPLICATE; browser fallback when no printer answers. Manual Swiggy/Zomato entry with sales-channel admin, markup, duplicate check and GST paid by the operator. Customers by phone with visits and lifetime value. Day-end report, owner dashboard and CSV exports (day-end and an invoice-wise sales register). Encrypted backups: hourly when something changed, 7/30/12 retention, second copy folder, import, and restore with a safety backup and a Hub restart, verified on a real Hub. Desktop app (`apps/desktop`): Electron shell that runs and supervises the Hub, keychain-sealed database key, raster window, tray, start at login, update channels, electron-builder for NSIS/AppImage/deb, and a manually triggered workflow that builds and smoke-tests the installers. Load test (`scripts/load-test.mjs`): 8 captains, 3 kitchen screens and 2 cashiers for 3 minutes, p95 11.9 ms and max 42 ms on the dev container (target p95 < 100 ms). Pilot runbook (docs/10) and training guide (docs/11). Web: reports portal, backups, sales channels, delivery, customers, KOT reprint (256 web + 32 UI tests). Server: 112 tests; desktop: 9. Screenshots: `docs/screenshots/sprint-5b/`. Fixed on the way: PATCH bodies no longer reset fields left out to their defaults (all update contracts). **Not done here / open:** installers could not be built in this environment (Electron and its packaging tools download from GitHub, which is blocked here); run the *Desktop installers* workflow. No code signing yet, and the update feed URL is a placeholder. A restore against the real Hub was done from the API; the web restore flow was tested against mocks only. E2E golden paths (Playwright) are still to be written. The load test runs on the dev container, not the pilot's Hub PC, and lets tables sit in CLEANING once billed, so later minutes are lighter than a real rush. Sign-in costs about 0.3 s of CPU each (bcrypt in JavaScript). A liquor item can be ordered through an aggregator (its LIQ bill then carries the "GST paid by operator" note): policy to decide. PDF/XLSX exports are not built (each needs a dependency).

| WP | Deliverable |
|---|---|
| 5.1 | `TaxEngine`: GST (inclusive/exclusive, CGST/SGST/IGST, line-level) + liquor VAT (rate + surcharge), mixed-order split into `INV`/`LIQ` invoices, aggregator `gst_paid_by_operator`, round-off. Exhaustive table tests vs. invoices hand-computed with a CA |
| 5.2 | Invoice generation, gapless numbering, discounts (limits per role + approval), coupons, service charge, complimentary |
| 5.3 | Payments: cash (tendered/change), card/UPI from **standalone terminals** (approval code/RRN, last 4, terminal), split, credit customer, aggregator; cash shifts with per-terminal reconciliation in X/Z report |
| 5.4 | Cancellation, refund → credit note, reprint (DUPLICATE watermark), all with audit + approval |
| 5.5 | Printing: ESC/POS templates (58/80 mm) for bill, liquor bill, KOT, X/Z report; network + USB + **Bluetooth** + OS spooler adapters; **raster mode for Hindi/Bengali** (Chromium off-screen render); printer test page |
| 5.5b | Manual aggregator orders: Delivery screen, sales-channel admin, duplicate check on external order id, channel net-revenue in day-end |
| 5.6 | Basic CRM: customer by phone at billing, visit count, LTV |
| 5.7 | Day-end report + owner dashboard (today/month/year sales, payment mix, kitchen stats) with export |
| 5.8 | Backups (hourly/daily, encrypted, retention, restore UI) |
| 5.9 | Electron packaging (Windows NSIS, Linux AppImage/deb), auto-start service, auto-update channel |
| 5.10 | E2E golden paths, k6 load test, pilot runbook & training guide |

## Definition of Done (every WP)

- Domain logic is unit tested. Each command has an integration test that covers permission denied, happy path, and invalid state.
- Every mutation writes `audit_logs` + `domain_events` + `sync_queue` in the same transaction. A shared test helper asserts this.
- Each endpoint has a Zod contract, with OpenAPI regenerated.
- UI: keyboard and touch tested, both themes, 768 px and 1366 px viewports, no a11y violations (axe).
- No `any`, no floating-point money, and no `DELETE` statements outside migrations (lint rule).
- Docs are updated when behaviour diverges from this design.
- UI work packages add a curated set of screenshots to `docs/screenshots/sprint-N/` (real Hub where possible, all three languages, 768 and 1366 px).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Printer driver diversity | Abstract `PrinterPort`, start with ESC/POS over TCP 9100 (most common), keep a certified-printer list |
| Bluetooth limits on real hardware (Android tablet models, Windows peripheral role, link count) | Spike in Sprint 1 (WP 1.7) on the pilot's actual tablets; Wi-Fi remains the primary path |
| Liquor tax/billing rules differ per state and change | State packs are data; each state's pack is reviewed with a tax advisor before its launch |
| SQLite native module + Electron ABI | Use `electron-rebuild` in CI and prebuilt binaries for win-x64 / linux-x64 |
| Hub PC failure mid-service | Hourly backups + Phase 6 standby Hub; Phase 1 documents a manual restore in < 10 min |
| GST rule changes | Tax groups are data, not code; rates are versioned with effective dates (added in WP 5.1 if needed) |
| Scope creep (enterprise feature list) | Phase gates; anything outside the phase table goes to the backlog |
