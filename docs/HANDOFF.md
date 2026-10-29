# Handoff: where the work stands

Branch: `claude/nifty-shannon-ahib6j`. Phases 1–4 are complete: the Core POS,
Stock, Purchase and Accounts, each with its backend, web portal, tests and
screenshots. So are reservations and loyalty points (Phase 5 CRM), the
owner's Overview, and an iPad/iPhone app. No role reaches a "Coming soon"
screen. Status notes per phase are in `docs/09-implementation-plan.md`.

## What each role has

| Role | Portals and features |
|---|---|
| Admin, Manager | Admin (Overview, menu, floor, customers with loyalty points, staff, roles, branch with loyalty settings, taxes, charges, coupons, printers, sales channels, devices, backups, audit log), plus every portal below |
| Captain | Captain: floor (filters, takeaway and delivery, move, merge, cleaning), order pad, **reservations** (book, change, seat and take the order, cancel, no-show; bookings show on the table tiles). Customers (guest list) |
| Cashier | POS: counter, bills, refunds, delivery, cash shift with X/Z. The **Points** tender spends a guest's loyalty points. Captain screens; reports |
| Kitchen | KDS, out-of-stock list |
| Inventory staff | Stock: items, stock in and out, counts, alerts, consumption. Purchase: vendors, orders, goods received |
| Accountant | Accounts: chart, day book, manual journals, ledgers, expenses, statements (trial balance, P&L, balance sheet, cash flow, GST summary). Purchase: vendor payments and dues. Reports, audit log, Overview |

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

**Apps**
- The iOS app is unsigned until an Apple Developer account's secrets are added.
- Scanning a pairing QR with the iPad camera pairs Safari, not the app; type
  the code instead.

## Next (docs/08-roadmap.md)

1. **Phase 1.5:** BLE command channel for the Wi-Fi-down mode, and the
   Capacitor Android app.
2. **Phase 5, still to do:**
   - the report engine (daily, weekly, monthly and annual) with PDF/XLSX
     export and scheduled reports;
   - the GSTR-1/3B returns and the liquor VAT registers;
   - membership tiers;
   - general availability of QR self-ordering;
   - the cloud relay and aggregator middleware.
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
