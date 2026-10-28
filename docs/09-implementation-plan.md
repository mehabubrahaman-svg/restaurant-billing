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

> **Status (2026-10-28)**: backend delivered and tested (WP 2.1–2.5 server side, 54 server tests). Web screens are in progress. Decisions made: hand-written SQL repositories instead of Drizzle (ADR 0010); sign-in bookkeeping doesn't bump the user's edit version; refresh cookie is not `Secure` until LAN TLS pairing (Sprint 3), with a config switch `RESTRO_SECURE_COOKIES`.

| WP | Deliverable |
|---|---|
| 2.1 | Auth: login, PIN login, refresh rotation with family revoke, lockout, `/auth/approve` manager override, JWT (jose, EdDSA) |
| 2.2 | RBAC: permission guard `requires()` preHandler, role templates (Admin, Manager, Cashier, Captain, Kitchen, Inventory, Accountant), UI `<Can permission>` |
| 2.3 | First-run setup wizard: organisation, branch, **state (wave 1 only) → state pack** (GST groups, liquor VAT groups or liquor disabled, separate liquor bill default, languages), GSTIN / VAT TIN / excise licence, admin user, backup passphrase |
| 2.4 | Users & roles admin UI · Settings UI (taxes, service charge, printers, receipt template) |
| 2.5 | Audit log writer (hash chain) + viewer; nightly chain verification job |

## Sprint 3 — Menu & floor (1.5 wks)

| WP | Deliverable |
|---|---|
| 3.1 | Catalog commands/queries: categories, items, variants, addon groups, kitchen stations, availability toggle; menu snapshot endpoint with ETag |
| 3.2 | Admin menu editor UI (bulk CSV import of menu) |
| 3.3 | Floor areas + tables, drag-and-drop layout editor, table state machine, QR token generation |
| 3.4 | Device pairing (mDNS advertise, **BLE advertise + GATT hub-info/pairing**, pairing QR, local CA), device registry, peripherals registry (BT/USB printers, scanners) |

## Sprint 4 — Ordering & Kitchen (2 wks)

| WP | Deliverable |
|---|---|
| 4.1 | `Order` aggregate: open, add/update/cancel items, totals, transfer/merge tables. Commands + tests |
| 4.2 | `Kot` aggregate + `FireKot` (split by station), state machine NEW→ACCEPTED→COOKING→READY→SERVED, chef assignment, `kot_status_events` |
| 4.3 | WebSocket gateway: auth, rooms, typed messages, `resume` with lastSeq |
| 4.4 | Captain portal: floor view, order pad, item sheet, quick search, send to kitchen, ready notifications; PWA + IndexedDB offline queue |
| 4.5 | KDS portal: 4-column board, sounds, delay colouring (`jobs/kot-delay-watcher`), bump, assign chef, metrics strip; Token display |

## Sprint 5 — Billing & go-live hardening (2.5 wks)

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
