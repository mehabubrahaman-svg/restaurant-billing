# Handoff: where the work stands

Branch: `claude/nifty-shannon-ahib6j`. Phases 1–4 are complete: the Core POS,
Stock, Purchase and Accounts, each with its backend, web portal, tests and
screenshots. So is Phase 5 (2026-10-28):
- reservations, loyalty points and membership tiers;
- the report engine with XLSX, CSV and print;
- GSTR-1, GSTR-3B and the VAT register;
- scheduled reports;
- QR self-ordering;
- online orders through the cloud relay;
- the stock value (inventory valuation).

So are the owner's Overview and an iPad/iPhone app. No role reaches a "Coming soon"
screen. Status notes per phase are in `docs/09-implementation-plan.md`.

## What each role has

| Role | Portals and features |
|---|---|
| Admin, Manager | Admin (Overview, menu, floor, customers with loyalty points and tiers, membership tiers, staff, roles, branch with loyalty settings, taxes, charges, coupons, printers, sales channels, online orders, devices, backups, audit log), plus every portal below. Reports: sales, GST returns, scheduled reports, consumption, stock value |
| Captain | Captain: floor (filters, takeaway and delivery, move, merge, cleaning), with **guest QR requests** at the top: accept an order onto the table, decline it, answer a call for a server or the bill. Order pad, **reservations** (book, change, seat and take the order, cancel, no-show; bookings show on the table tiles). Customers (guest list) |
| Cashier | POS: counter, bills, refunds, delivery, cash shift with X/Z. The **Points** tender spends a guest's loyalty points. Captain screens; reports |
| Kitchen | KDS, out-of-stock list |
| Inventory staff | Stock: items, stock in and out, counts, alerts, consumption, stock value (no export). Purchase: vendors, orders, goods received |
| Accountant | Accounts: chart, day book, manual journals, ledgers, expenses, statements (trial balance, P&L, balance sheet, cash flow, GST summary). Purchase: vendor payments and dues. Reports (sales, GST returns, scheduled, consumption, stock value), audit log, Overview |

`sync.manage` (Phase 6 cloud sync) is the only permission with no screen;
nothing shows it.

## Where things are

- **Stock:** `packages/application/src/inventory/` (`InventoryService`,
  `StockLedger`, `InventoryProjector`), routes `apps/server/src/http/routes/inventory.ts`,
  web `apps/web/src/portals/inventory/`.
- **Purchase:** `packages/application/src/purchasing/`, routes `purchasing.ts`,
  web `apps/web/src/portals/purchase/`.
- **Accounts:** `packages/application/src/accounting/` (`AccountingService`,
  `AccountingProjector`, `JournalWriter`), routes `accounting.ts`, web
  `apps/web/src/portals/accounts/`. The test server fails any test in which a
  projector skipped an event.
- **Reservations:** `packages/application/src/floor/reservation-service.ts`,
  routes `reservations.ts`, web `apps/web/src/portals/captain/reservations-page.tsx`.
  Live updates use the `floor.reservations.changed` WebSocket message.
- **Loyalty:** `packages/domain/src/crm/loyalty.ts` (the rules),
  `packages/application/src/crm/loyalty.ts` (`LoyaltyService`, used inside
  billing transactions), migration `0013_loyalty.sql`. Web: Admin → Branch
  (settings), Admin → Customers (balance, history, adjust), and the POS
  payment pad (Points tender).
- **Overview:** `apps/web/src/features/admin/overview/overview-page.tsx`.
- **Reports and GST:** `packages/application/src/reporting/`:
  - `periods.ts`, `workbook.ts`, `sales-workbook.ts`;
  - `gst.ts`;
  - `schedules.ts` (`ReportScheduleService`, run every 15 minutes from `apps/server/src/main.ts`).

  Queries are in `packages/infrastructure/src/reporting/`, including the XLSX writer `xlsx.ts`. Routes are in `reports.ts`; the web pages are in `apps/web/src/portals/reports/` (`sales-page`, `gst-page`, `scheduled-page`).
- **Stock value (inventory valuation):**
  - the query is `SqliteInventoryQueries.valuation`. It works the average cost of a past day out again with `averageCostAfter` (`packages/domain/src/inventory/stock.ts`);
  - the workbook is `packages/application/src/reporting/inventory-workbook.ts`;
  - routes are beside the consumption report in `inventory.ts`;
  - the web page is `apps/web/src/portals/inventory/valuation-page.tsx`, under Stock and under Reports.
- **Membership tiers:** `packages/domain/src/crm/membership.ts` (the rules),
  `packages/application/src/crm/membership.ts`. The member discount is added in
  `BillingService.memberDiscount`. Web: Admin → Membership, and the tier on
  Customers and at the POS.
- **QR self-ordering:** `packages/application/src/ordering/qr-ordering.ts`.
  The accept step is `OrderService.addGuestOrder`. Routes are in `qr.ts`: public `/public/qr/...`, staff `/qr-requests`. Web: `apps/web/src/portals/qr-menu/`, and `features/orders/qr-requests-panel.tsx` on the captain floor.
- **Online orders:**
  - the relay: `apps/relay`;
  - the protocol: `packages/contracts/src/relay.ts`;
  - the Hub side: `packages/application/src/integrations/relay.ts`, `apps/server/src/relay/` (client and feeds) and routes `integrations.ts`;
  - web: Admin → Online orders.

  Deploying it is in docs/12 ("Online orders").
- **iOS app:** `apps/ios` (SwiftUI WKWebView shell, ADR 0011),
  `.github/workflows/ios.yml`; see `apps/ios/README.md`.
- **Windows/Linux Hub:** `apps/desktop`, `.github/workflows/desktop.yml`.

## Releases

- **Windows and Linux installers:** push a tag `hub-v<version>` (the version
  in `apps/desktop/package.json`), or run **Desktop installers** from the
  Actions tab. The artifacts are `restroos-hub-Windows` and
  `restroos-hub-Linux`.
- **iOS:** every push that changes `apps/ios` builds it; tag `ios-v<version>`
  for a release. The artifact `restroos-ios` holds the unsigned `.ipa` (to
  sideload) and, once the signing secrets are set, a signed one.

## Known gaps (not fixed)

**Stock and accounts**
- Receipts and opening stock are journaled at the rounded unit cost, which is
  out by under 0.5 paise per kg.
- No revaluation is posted for negative stock.
- On first start, the accounting projector journals all history in one go
  (synchronously).
- Migration 0012's copy step works only on empty tables (true everywhere so far).

**Purchase**
- GRNs aren't checked against the PO's quantity or price, so the approval can
  be bypassed.
- `po.create` can cancel or close an approved PO.
- A direct receipt (Stock → Received) credits Cash under `inventory.adjust`.

**Billing, customers and loyalty**
- A credit sale without a phone number has no customer party, so it can't be
  followed on a customer ledger.
- A cancelled bill's reversal is dated on the bill's own day.
- The GST summary reads the current `tax_groups.tax_type`.
- Expense "paid from" also accepts untagged asset accounts.
- Refunds by credit note don't take back earned loyalty points.
- Cancelling a paid bill doesn't undo the visit count.
- Points earned aren't a liability in the books; they post to Sales returns
  only when spent.
- Aggregator settlement isn't posted.

**Ordering and stock consumption**
- Deducting stock at invoice, instead of at KOT, isn't built.
- Cancelling a whole order leaves its consumption in place.

**Data the Hub returns in English**
- These come back in English and the web rebuilds or shows them as they are:
  stock-movement and journal narrations, vendor statement descriptions, and
  ingredient names other than on stock items.
- `/reports/consumption` needs explicit dates.
- A receipt's bill reference isn't stored on its movements.
- A posted count's lines and its total can differ by a paisa.

**Permissions**
- A custom role with `po.create` but neither `inventory.view` nor
  `menu.manage` can't pick items.
- The Accountant role can't search customers in the party ledger.
- Manual journal lines have no party picker, though the contract supports one.
- Vendor payments can't be edited or refunded.

**Reports and GST**
- The GSTR-1 workbook's column headings follow the GST offline tool's template as remembered. Check them against the current template before the first filing.
- GSTR-3B input tax credit is set off head by head, without cross-utilisation. It is marked not allowed when every GST line is at 5%.
- Lines without an HSN code, and charges, count as SAC 996331.
- Table 5 counts purchases from unregistered vendors as intra-state.
- PDF is the browser's print. Scheduled reports aren't emailed: they stay on the Hub and in the copy folder.
- After the Hub was off, scheduled reports catch up with the latest period only.

**Stock value**
- Stock at or below zero is valued at nil, and no revaluation is posted for it. The report shows what that leaves as the cost difference, and the difference from the books.
- A past day's average cost is replayed from receipts in the order they were posted. A movement dated an earlier business day than ones posted before it would be costed in posting order. Nothing posts such movements today.
- The comparison with the books reads the Inventory account only, not accounts kept under it.

**Membership and QR ordering**
- A guest's tier is worked out when it is read, so there is no tier history. Tiers are the same for every branch.
- The member discount comes after a manual discount and a coupon (they stack).
- A table takes QR orders as soon as it has a QR code. There is no menu-only mode and no branch switch; making a new code stops the old one.
- The guest page shows prices before tax. It has no online payment and doesn't show the running bill.
- The order's source (QR) is stored but not in the order contract, so screens don't badge QR orders.

**Online orders (relay)**
- The middleware format is our own documented JSON. A real provider (UrbanPiper, for example) needs a small adapter in front of the relay. It hasn't been tested against a live provider: there is no partner account yet.
- Hubs are added to the relay from the command line. The relay has no admin screen.
- The relay keeps the webhook secret and the middleware key in plain text in its database. Only the Hub's key is hashed.
- The relay needs a reverse proxy for HTTPS.
- One relay link per Hub (the first branch with it on).
- An order the Hub can't enter isn't rejected on the platform: staff key it in or retry it.

**Apps**
- The iOS app is unsigned until an Apple Developer account's secrets are added.
- Scanning a pairing QR with the iPad camera pairs Safari, not the app; type
  the code instead.

## Waiting on the owner (2026-10-28)

- **A release.** Nothing has been released since 0.2.0: Phase 5 is on the branch only. If the owner asks, do the 0.3.0 release:
  - bump `apps/desktop/package.json` and the version in docs/12;
  - push the tags `hub-v0.3.0` and `ios-v0.3.0` (see Releases above).
- **Online orders going live.** This needs an aggregator middleware account (UrbanPiper, for example) and a small cloud server for the relay. Then write an adapter from that provider's webhook and API format to `packages/contracts/src/relay.ts`.
- **GSTR-1.** Check the workbook's column headings against the current GST offline tool before the first filing.
- **Hub on an Android tablet.** The owner asked; the answer was not today, since the Hub is Node with a native SQLite library, and Android stops background apps. The options given:
  - Termux, for a demo only;
  - a real Android Hub app (nodejs-mobile, a foreground service, starting on boot), as new work after Phase 5 of about a week or more;
  - a small always-on PC or a Raspberry Pi 4/5 running from source (recommended). The published Linux installer is x64 only.

  Waiting for the owner to choose.

## Working notes for the next session

- CI (`ci.yml`) runs only on `main` and pull requests. Pushes to this branch aren't checked on GitHub, so the local checks below are the gate. The desktop and iOS workflows run on their tags and paths.
- **Locale files:** add keys as text, never by a `JSON.parse`/`JSON.stringify` round trip. The round trip moves integer-like keys, such as the state codes ("19"), to the front of their object. Check for duplicate keys afterwards.
- **Flaky tests:** under full-suite load, a few tests can time out: on the web, device pairing and the recipe section; on the server, the backup import (scrypt). Rerun the file on its own before treating it as a failure. `--continue` on `turbo run test` shows every package's result, not just up to the first failure.
- **Relay tests:** both the relay's own tests and the Hub's `relay.test.ts` run a real relay and WebSocket on 127.0.0.1, on a random port.
- **Migrations:** 0014 to 0019 were added in Phase 5. Every new business table has a no-delete trigger, as in 0004.
- **Rebuilding a table that others point at** (to change a CHECK): rebuild the child tables too, with their new copies pointing at the new parent, and drop the old children before the old parent. 0019 does this for `report_schedules` and `report_files`. Dropping a parent while children still point at it fails at commit, even with `defer_foreign_keys`, because SQLite counts those references when the old parent's rows go and doesn't recount them after the rename.

## Next (docs/08-roadmap.md)

1. **Phase 1.5:** BLE command channel for the Wi-Fi-down mode, and the
   Capacitor Android app.
2. **Phase 5, still to do:** a middleware adapter, once a provider
   account is chosen.
3. **Phase 6:** cloud sync and multi-branch (`sync.manage`); **Phase 7:** AI.

## Checks before every commit

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

```bash
pnpm db:validate
```

```bash
pnpm --filter @restroos/e2e test:e2e
```

The end-to-end run needs `pnpm build` first and Chromium
(`pnpm --filter @restroos/e2e exec playwright install chromium`). On a busy
machine, run the unit tests one package at a time
(`pnpm turbo run test --concurrency=1`).
