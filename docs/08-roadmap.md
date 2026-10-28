# 08 — Development Roadmap

Durations assume a team of 2–3 full-stack engineers and 1 QA. Every phase ends with a **shippable, installable build** that a pilot restaurant can use.

| Phase | Scope | Duration | Exit criteria |
|---|---|---|---|
| **0 · Planning** | Architecture, schema, API, wireframes, sequences, roadmap | 1 wk | Docs reviewed; product decisions recorded in `01-architecture.md §8` ✔ |
| **1 · Core POS** | Login/RBAC, setup wizard with **wave 1 state packs**, menu, floor/tables, captain ordering, KOT + KDS, billing (**GST + liquor VAT**, separate liquor bill), payments incl. split (**standalone card/UPI terminals, keyed reference + shift reconciliation**), discounts with approval, refunds/credit notes, thermal printing (incl. **Hindi/Bengali raster**), cash shifts, day-end report, audit log, backups, LAN + **Bluetooth discovery/pairing**, Bluetooth peripherals, **manual Swiggy/Zomato entry**, token display, **UI in English/Hindi/Bengali** | 10–12 wks | Pilot restaurant runs a full service day with zero data loss; p95 API < 100 ms on target hardware |
| **1.5 · Bluetooth fallback** | BLE command channel (Wi-Fi-down mode), Capacitor **Android** app (APK/MDM distribution, KDS kiosk mode), field test in pilot | 3 wks | Captain → KDS flow works for a full service with Wi-Fi switched off |
| **2 · Inventory** | Inventory items, recipes, auto-consumption on KOT, wastage, opening/closing counts, batches + expiry, low/overstock alerts | 4 wks | Theoretical vs. actual consumption variance report < 5% on pilot |
| **3 · Vendors** | Vendors, PO → approval → GRN → stock update, vendor payments, dues ageing | 3 wks | Full purchase cycle with auto stock update |
| **4 · Accounts** | Chart of accounts, auto-journals (sales, purchase, payment, COGS, expenses), ledgers, P&L, balance sheet, cash flow, GST reports (GSTR-1/3B summaries) | 5 wks | Trial balance always balances; accountant sign-off on sample month |
| **5 · Reporting, CRM & Aggregators** | Report engine (daily/weekly/monthly/annual), GSTR-1/3B + liquor VAT registers, PDF/XLSX/CSV export, scheduled reports, customer history, favourites, LTV, loyalty points, membership tiers, QR self-ordering GA, **cloud relay + aggregator middleware integration** (auto order ingestion, menu/stock push) | 6 wks | All reports listed in the brief available + exportable |
| **6 · Cloud Sync & Multi-branch** | Sync worker, cloud API (PostgreSQL), head-office dashboard, central menu management, conflict UI, standby Hub fail-over | 6–8 wks | 2 branches sync for 2 weeks with zero lost events; fail-over drill < 5 min |
| **7 · AI** | Demand forecasting, inventory reorder prediction, revenue analytics, customer segmentation, recommendations | 6 wks+ | Forecast MAPE target agreed with pilot |

## State rollout

| Wave | States | When |
|---|---|---|
| 1 | **North**: J&K, Ladakh, Himachal, Punjab, Chandigarh, Uttarakhand, Haryana, Delhi, Rajasthan, UP · **East**: Bihar, West Bengal, Jharkhand, Odisha · **North-East**: Sikkim, Arunachal, Nagaland, Manipur, Mizoram, Tripura, Meghalaya, Assam | Phase 1 |
| 2 | **West**: Gujarat, Maharashtra, Goa, DNH&DD · **South**: Karnataka, Kerala, Tamil Nadu, Puducherry, Telangana, Andhra Pradesh · **Central**: MP, Chhattisgarh · **Islands** | Once the platform is stable (target: after Phase 3 pilot sign-off). Needs state-pack review + Marathi/Gujarati/Tamil/Telugu/Kannada/Malayalam translations; **no code changes** |

## Backlog (decided "not yet")
- GST e-invoicing (IRN + signed QR) for B2B invoices
- Integrated card/UPI terminals (`PaymentTerminalPort` is ready)
- Direct aggregator APIs (beyond middleware)

## Cross-phase tracks (continuous)

- **Quality**: unit tests on domain ≥ 90% line coverage; integration tests for every command; Playwright E2E for the 5 golden paths (order→KOT→bill, split pay, refund, offline captain, day-end).
- **Performance**: k6 load test in CI on every release: 100 virtual users, 10 orders/s for 30 min, p95 < 500 ms.
- **Security**: dependency audit, OWASP ASVS L2 checklist each phase, penetration test before Phase 6 GA.
- **Packaging**: Windows (NSIS, x64) and Linux (AppImage + .deb), code-signed, with delta auto-updates and a staged rollout ring.

## Milestones

```mermaid
gantt
  dateFormat  YYYY-MM-DD
  title RestroOS delivery plan
  section Foundation
  Phase 0 Planning           :done,   p0, 2026-10-28, 7d
  section Core
  Phase 1 Core POS           :active, p1, after p0, 84d
  Pilot restaurant go-live   :milestone, after p1, 0d
  Phase 1.5 BT fallback      :p15, after p1, 21d
  section Back office
  Phase 2 Inventory          :p2, after p15, 28d
  Phase 3 Vendors            :p3, after p2, 21d
  Phase 4 Accounts           :p4, after p3, 35d
  Phase 5 Reports CRM Aggreg :p5, after p4, 42d
  section Rollout
  Wave 2 states (W, S, C)    :w2, after p3, 28d
  section Scale
  Phase 6 Cloud Sync         :p6, after p5, 56d
  Phase 7 AI                 :p7, after p6, 42d
```
