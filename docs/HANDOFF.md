# Handoff: where the work stands

Branch: `claude/nifty-shannon-ahib6j`. Phase 1 (Sprints 1–5) is complete and
pushed; see `docs/09-implementation-plan.md` for its status notes. The owner
asked to build **Stock (Phase 2), then Purchase (Phase 3), then Accounts
(Phase 4)** in that order (`docs/08-roadmap.md`). The menu entries for them
exist and show "Coming soon" (`apps/web/src/portals/portal-placeholder.tsx`).
The database tables for all three are already in
`database/migrations/0001_initial_schema.sql` (§6 Inventory, §10 Vendors &
purchasing, §11 Accounting); permissions and the INVENTORY and ACCOUNTANT role
templates exist (`packages/domain/src/identity/`).

## Phase 2 (Stock): done so far

- `packages/domain/src/inventory/stock.ts` (+ tests): stock value, cost per
  1000 base units, weighted average cost, recipe consumption with trim loss
  and add-ons, FEFO batch allocation, stock level (OUT/LOW/OK/OVER).
- `database/migrations/0010_inventory.sql`: `inventory_items.name_translations`,
  `stock_counts.notes`, `projection_checkpoints` (seeded at the current
  `domain_events` seq so old orders aren't consumed), two indexes.
- Steps 1–5 below (backend): contracts `packages/contracts/src/http/inventory.ts`;
  `packages/application/src/inventory/` (`InventoryService`, `StockLedger`
  shared by every stock change, `InventoryProjector`); SQLite repository,
  queries and `SqliteProjectionLog`; routes `apps/server/src/http/routes/inventory.ts`,
  projector wired in `app.ts` (subscribed to `KotFired` and
  `OrderItemCancelled`, catches up at start); tests `apps/server/src/http/inventory.test.ts`.

## Phase 2: the plan for what's left

Units: quantities are integer milli-units of the item's base unit (g, ml,
pc), costs are paise per 1000 base units (`units` table seeded in 0002).

1. **Contracts** `packages/contracts/src/http/inventory.ts` (export from
   `index.ts`): units; inventory item (sku, name, translations, category, base
   unit, purchase unit, perishable, shelf life, per-branch reorder/max levels,
   stock qty, avg cost, value, level); save/update (use `patchSchema` from
   `common.ts` for PATCH bodies); recipe `{menuItemId, variantId|null,
   yieldPortions, ingredients[{inventoryItemId, qtyMilli, wastageBp}]}` with
   cost per portion and food-cost %; add-on ingredients; receipts (direct
   purchase with optional batch no. and expiry), opening stock, wastage,
   adjustment; movements list; stock counts (draft → lines → post); alerts
   (low/out/over, batches expiring in 3 days, negative stock); consumption
   report (opening, received, sold, wastage, count variance, closing,
   variance %). New problem codes in `http/problem.ts`.
2. **Application** `packages/application/src/inventory/`: ports
   (repositories + queries), `InventoryService` (items, recipes, add-on
   ingredients, receipts/opening/wastage/adjustments, counts; every command
   through `UnitOfWork.run` with `scope.audit` and `recordChanged` events,
   like `billing/shift-service.ts`), `InventoryProjector`.
3. **Automatic consumption** (`InventoryProjector`): reads `domain_events`
   after its `projection_checkpoints` row, in one transaction with its writes.
   `KotFired` (payload `itemIds` = order item ids) → for each item, recipe for
   its variant else the item-level recipe, plus add-on ingredients →
   `consumptionFor` → `SALE_CONSUMPTION` movements (reference
   `ORDER_ITEM`), FEFO from batches, at average cost. `OrderItemCancelled`
   with `wasSent` → `SALE_REVERSAL` of that item's movements; when
   `isWastage` also a `WASTAGE` movement. Run it after each publish
   (`eventBus.subscribe('*')`) and once at start-up; wire it in
   `apps/server/src/http/app.ts` so tests get it too. Stock may go negative;
   never block a sale.
4. **Infrastructure** `packages/infrastructure/src/inventory/`: SQLite
   repositories and queries; `inventory_stock` row updated in the same
   transaction as each `stock_movements` insert (append-only by trigger).
5. **Server** `apps/server/src/http/routes/inventory.ts` (`/inventory-items`,
   `/recipes`, `/addons/{id}/ingredients`, `/stock/receipts|opening|wastage|adjustments`,
   `/stock/movements`, `/stock-counts`, `/stock/alerts`,
   `/reports/consumption`), container wiring, integration tests in the style
   of `apps/server/src/http/billing.test.ts` (fixture
   `apps/server/src/testing/restaurant.ts`). Permissions: `inventory.view`,
   `inventory.manage_items`, `inventory.adjust`, `inventory.count`,
   `reports.inventory`.
6. **Web** `apps/web/src/portals/inventory/` replacing the placeholder: items
   with levels, recipe editor on menu items, receive/opening/wastage forms,
   stock count sheet, alerts, consumption report. Three languages; follow
   `portals/pos` patterns and tests.
7. Docs: `docs/03` (migration 0010), `docs/05` (Inventory section), `docs/09`
   status; screenshots in `docs/screenshots/phase-2/`; extend `e2e/`.

Then Phase 3 (vendors, PO → approval → GRN posts `PURCHASE` movements and
batches, vendor payments, dues ageing) and Phase 4 (chart of accounts,
automatic journals from sales, purchases, payments and COGS, ledgers, P&L,
balance sheet, cash flow, GST summaries).

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

(The end-to-end run needs `pnpm build` first and Chromium:
`pnpm --filter @restroos/e2e exec playwright install chromium`.)
