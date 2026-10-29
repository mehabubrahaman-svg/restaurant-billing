# 03 — Database Design

Source of truth: [`database/migrations/0001_initial_schema.sql`](../database/migrations/0001_initial_schema.sql) and [`0002_seed_reference_data.sql`](../database/migrations/0002_seed_reference_data.sql).
The migrations are validated in CI (`pnpm db:validate`): 78 tables, all FKs resolve.

| Migration | Contents |
|---|---|
| `0001_initial_schema` | All business tables, append-only and no-delete triggers on ledgers and main documents, reporting views |
| `0002_seed_reference_data` | Indian states (GST codes, waves, languages, liquor defaults), units, 52 permissions |
| `0003_idempotency_keys` | Idempotency-Key cache for retried POST commands |
| `0004_complete_delete_guards` | Delete guards on every remaining business table; draft-only deletion for PO and stock-count lines |
| `0005_auth_support` | `system_secrets` (signing key, local CA), branch on refresh tokens |
| `0006_catalog_floor_devices` | Menu item sort order, add-on group translations, device token hash + pairing, `pairing_codes` |
| `0007_ordering_kitchen` | Merge link on orders; wastage flag, ready time, kitchen station and food mark on order items; token and KOT-by-order indexes |
| `0008_billing` | Per-line tax breakdown and credit-note links on invoice lines, taxed charges, coupon code on discounts, B2B customer name and refunded total on invoices, denominations on cash shifts, one open shift per counter |
| `0009_backups` | Backups table rebuilt: PRE_RESTORE and IMPORTED kinds, status (AVAILABLE / PRUNED / MISSING) instead of deleting rows, schema version, second-copy path |
| `0010_inventory` | Hindi/Bengali names on inventory items, notes on stock counts, `projection_checkpoints` (how far each projector has read `domain_events`; the inventory one starts after the events already there, so old orders aren't consumed), batch and ingredient indexes |
| `0011_purchasing` | PO sent time and cancel reason; GRN due date, notes, cancel reason and `input_tax_kind` (CGST_SGST / IGST / NONE); a draft GRN's lines can be replaced (refused once posted); purchasing indexes |
| `0012_accounting` | `account_templates` and the chart of accounts seeded for every organisation (a trigger seeds new ones); `journal_entries` and `journal_lines` rebuilt so system postings have no user (`created_by` NULL), stock posts as `STOCK` and a document has one original entry (`ux_journal_source_original`); expense reference and cancel reason |
| `0013_loyalty` | `loyalty_transactions.note` (why a manager adjusted points) and indexes by customer and invoice. The program's settings are `settings` keys `loyalty.enabled`, `loyalty.earn_per_100`, `loyalty.point_value`, `loyalty.min_redeem`. Points are spent as the `LOYALTY` payment method; `customers.loyalty_points` is the ledger's cached balance |
| `0014_gst_returns` | `sales_channels.operator_gstin`: the GSTIN of the e-commerce operator that pays the GST on the channel's orders under section 9(5), for GSTR-1 table 14 |

Released migrations are immutable: the migrator stores a SHA-256 of each file and refuses to start if one changes. Fixes are new migrations.

## 1. Engine configuration

```sql
PRAGMA journal_mode = WAL;        -- readers never block the writer
PRAGMA synchronous = NORMAL;      -- durable across app crash; with WAL, safe + fast
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -65536;       -- 64 MB page cache
PRAGMA temp_store = MEMORY;
PRAGMA key = '<derived key>';     -- SQLCipher, set first on open
```

Writes always use `BEGIN IMMEDIATE`, so the write lock is taken up front and deadlocks between read→write upgrades can't happen.

## 2. Conventions

| Concern | Rule | Reason |
|---|---|---|
| Primary keys | `TEXT` UUIDv7 | Created offline on any device, globally unique for sync, time-ordered so B-tree inserts stay local. |
| Timestamps | ISO-8601 UTC text (`…Z`) | Sorts lexicographically, maps to `timestamptz`. |
| Business date | `business_date TEXT 'YYYY-MM-DD'` in branch timezone | A restaurant "day" may close at 3 AM. Reports group by business date, not calendar date. |
| Money | `INTEGER` paise | No floating-point drift. ₹249.50 = `24950`. |
| Translations | `name_translations` JSON on categories, items, variants, addons | `{"hi":"चिकन बिरयानी","bn":"চিকেন বিরিয়ানি"}`. The English `name` is always present as the fallback. |
| Rates | `INTEGER` basis points | 5% GST = `500`, 2.5% CGST = `250`. |
| Stock quantities | `INTEGER` milli-units of the base unit (g / ml / pc) | 200 g rice = `200000`, 1.5 eggs (rare but possible in recipes) = `1500`. |
| Soft delete | `deleted_at`, `deleted_by` + `BEFORE DELETE` triggers that abort | "Nothing should be deletable." |
| Concurrency | `version INTEGER`, incremented on each update; `UPDATE … WHERE id=? AND version=?` | Optimistic locking locally, conflict detection for sync. |
| Snapshots | Order items and invoice lines copy name/price/tax at the time of sale | Menu price changes never alter historical bills. |
| Append-only | `stock_movements`, `journal_*`, `payments`, `audit_logs`, `domain_events`, `kot_status_events`, `loyalty_transactions`, `invoice_lines/taxes` | Corrections are new reversing rows. |
| Strict typing | Every table is `STRICT` | SQLite rejects wrong types instead of silently coercing them. |

## 3. Table catalogue (grouped by bounded context)

| Context | Tables |
|---|---|
| Organisation | `indian_states`, `organizations`, `branches`, `settings`, `devices`, `printers`, `peripherals` |
| Identity | `permissions`, `roles`, `role_permissions`, `users`, `user_roles`, `refresh_tokens`, `staff_attendance` |
| Tax | `tax_groups`, `tax_components`, `charge_rules` |
| Floor | `floor_areas`, `dining_tables`, `reservations` |
| Catalog | `kitchen_stations`, `categories`, `menu_items`, `branch_menu_items`, `menu_item_variants`, `addon_groups`, `addons`, `menu_item_addon_groups` |
| Inventory | `units`, `inventory_items`, `inventory_stock`, `stock_batches`, `recipes`, `recipe_ingredients`, `addon_ingredients`, `stock_movements`, `stock_counts`, `stock_count_lines` |
| CRM | `customers`, `loyalty_transactions` |
| Ordering & Kitchen | `sales_channels`, `orders`, `order_items`, `order_item_addons`, `kots`, `kot_status_events` |
| Billing | `document_sequences`, `coupons`, `invoices`, `invoice_lines`, `invoice_taxes`, `invoice_discounts`, `invoice_charges`, `payments`, `cash_shifts`, `shift_tender_counts` |
| Purchasing | `vendors`, `purchase_orders`, `purchase_order_lines`, `grns`, `grn_lines`, `vendor_payments` |
| Accounting | `account_templates`, `accounts`, `journal_entries`, `journal_lines`, `expenses` |
| Platform | `audit_logs`, `notifications`, `domain_events`, `projection_checkpoints`, `sync_queue`, `sync_state`, `sync_conflicts`, `backups` |

**Mapping to the requested entities**: Users, Roles, Permissions ✔ · Tables → `dining_tables` (`tables` is an SQL keyword) ✔ · Orders, OrderItems ✔ · MenuItems, Categories ✔ · Inventory → `inventory_items` + `inventory_stock` ✔ · Recipes ✔ · Vendors ✔ · Purchases → `purchase_orders` + `grns` ✔ · StockMovements ✔ · Ledgers → `accounts` + `journal_*`, ledgers are views ✔ · Payments ✔ · AuditLogs ✔ · Notifications ✔ · SyncQueue ✔.

## 4. Key design decisions

### 4.1 Orders vs. KOTs vs. Invoices
- An **order** is the open tab for a table or takeaway. It collects items over time.
- A **KOT** is a batch of items fired to one kitchen station. Each "send to kitchen" creates one KOT per station. `order_items.kot_id` links each item to the KOT that fired it.
- An **invoice** is the legal document created at billing. Its lines are a frozen copy. Refunds create a **credit note** (`invoices.kind = 'CREDIT_NOTE'`, `original_invoice_id`) plus negative `payments`. Invoices are never edited.

### 4.2 Taxes, invoice series and channels
- **Tax type lives on the tax group, not the branch**: `tax_groups.tax_type = GST | VAT`. A menu item's group decides how it is taxed, so food (GST) and liquor (state VAT) can sit in one order.
- `tax_groups.invoice_series` routes liquor to its own gapless series (`LIQ`) when the branch bills liquor separately. One order can then produce two invoices (`orders` 1 → N `invoices`).
- `sales_channels` records Swiggy/Zomato etc. with commission and the `gst_paid_by_operator` flag, which is copied onto each invoice so historic GST reports never change if the flag is edited.
- **Payments on standalone terminals**: `payments.reference` (approval code / UPI RRN), `card_last4`, `terminal_label`. `shift_tender_counts` stores expected vs. reported totals per tender and terminal at shift close.

### 4.3 Material consumption engine
Implemented in Phase 2 (`packages/application/src/inventory/`). The `InventoryProjector` reads `domain_events` after its `projection_checkpoints` row and applies each event in one transaction with the checkpoint, so a dish is consumed exactly once, also after a crash or a restart (it catches up at start). On `KotFired`, for each fired item it:
1. Resolves the active recipe for `(menu_item_id, variant_id)`, falling back to the item-level recipe.
2. Computes `qty_milli × quantity / yield_portions × (1 + wastage_bp/10000)` for each ingredient, plus addon ingredients × addon quantity.
3. Inserts `stock_movements(SALE_CONSUMPTION, -qty)` at the weighted average cost (reference `ORDER_ITEM`) and updates `inventory_stock` in the same transaction, consuming batches FEFO (earliest expiry first).
4. If an item is cancelled after firing (`OrderItemCancelled` with `wasSent`), its movements are put back as `SALE_REVERSAL` (into the batch they came from, at their cost); when the dish was thrown away (`isWastage`) the same quantities are then booked as `WASTAGE`.

Stock may go negative: a sale is never blocked (the alerts list negative stock). Every other change to stock (receipts, opening stock, GRNs, wastage, adjustments, counts) goes through the same `StockLedger`, which keeps the movement, the balance and the weighted average cost together. Deduction is at **KOT fire**, which matches real kitchen consumption; deducting at invoice instead is not built. Cancelling a whole order after firing leaves the consumption in place (the food was made).

Example (Chicken Biryani, 1 portion): Rice 200 g → `200000`, Chicken 150 g → `150000`, Oil 20 ml → `20000`.

### 4.4 Accounting postings (auto-journal)

Implemented in Phase 4 (`packages/application/src/accounting/`). The `AccountingProjector` posts documents from their events (checkpoint `accounting`) and stock from a cursor over `stock_movements` rowids (checkpoint `accounting-stock`), each batch in one transaction with its checkpoint. It runs after the inventory projector, and catches up at start, so history from before Phase 4 is journaled too. Accounts are found by `accounts.system_tag`; entries are numbered `KOL1/JV/2026-27/000042`; `created_by` is the user who caused the posting, NULL for stock. Expenses and manual journals are posted by `AccountingService` in their own transaction.

| Event | Debit | Credit |
|---|---|---|
| Invoice issued (`InvoiceIssued`) | Customer receivables (party: the customer, if named) | Sales: food (GST lines) / liquor (VAT lines); Service charge income; Output CGST/SGST/IGST/cess; Output VAT and surcharge (liquor); Rounding (either side) |
| Aggregator invoice (`gst_paid_by_operator`) | Customer receivables | Sales, with no output GST (the bill carries none: the operator pays it) |
| Payment received (`PaymentRecorded`), one entry per payment | Cash (CASH) · Card and UPI clearing (CARD, UPI, WALLET) · Aggregator receivables (AGGREGATOR); CREDIT posts nothing, the receivable stays | Customer receivables |
| Credit note (`CreditNoteIssued`) | Sales returns; Service charge; Output tax | Customer receivables |
| Refund paid (`RefundPaid`, negative payment) | Customer receivables | Cash / Card and UPI clearing |
| Invoice cancelled (`InvoiceCancelled`) | The bill's entry reversed (`reversal_of_id`); its reversing payments post as refunds | |
| GRN posted (`GrnPosted`) | Inventory (subtotal); Input CGST + SGST (same state) or Input IGST (other state); without a GSTIN, Inventory takes the whole bill | Vendor payables (party: the vendor) |
| Vendor payment (`VendorPaymentRecorded`) | Vendor payables (party: the vendor) | Cash (CASH) / Bank (BANK, UPI, CHEQUE) |
| Stock sold, net of reversals | Cost of goods sold | Inventory |
| Wastage | Wastage | Inventory |
| Adjustments and stock-count differences | Stock adjustments (either side) | Inventory |
| Opening stock | Inventory | Opening balance equity |
| Stock bought for cash (direct receipt) | Inventory | Cash |
| Expense | Expense account (amount less GST); Input CGST + SGST | Cash / Bank (any asset account) |
| Expense cancelled | The expense's entry reversed | |
| Manual journal | As entered (must balance); reversed, never edited | |

Stock entries are one per branch, business day and kind each time the projector runs (in practice one per KOT, receipt or count). Aggregator settlement (bank, commission, input GST on commission) is not posted yet: aggregator receivables are cleared with a manual journal.

Sub-ledgers (customer, vendor) are `journal_lines.party_type/party_id`. Trial balance, P&L, balance sheet and cash flow are aggregations over the journal lines; cost of sales in the P&L is cost of goods sold, wastage and stock adjustments.

### 4.5 Audit trail
Every command writes one `audit_logs` row (actor, approver, device, before/after JSON, reason). The hash chain (`prev_hash`, `hash`) makes tampering detectable, even by someone with direct DB access.

### 4.6 Sync readiness
Every command appends `domain_events` (local `seq` gives total order) and a `sync_queue` row **in the same transaction** (transactional outbox). Nothing is lost if the app crashes between commit and upload.

## 5. Indexing strategy
- Hot paths have partial indexes: open orders (`ix_orders_open`), active KOTs (`ix_kots_active`), pending sync (`ix_sync_pending`), unexpired batches.
- Reports use `(branch_id, business_date)` composite indexes on orders, invoices, payments, and stock movements.
- Menu search uses `name COLLATE NOCASE`. Phase 1 adds an FTS5 virtual table `menu_items_fts` if search over 2,000+ items is slow.

## 6. Capacity estimate (one branch, 50,000 orders/day worst case)

| Table | Rows/day | Avg row | MB/day |
|---|---|---|---|
| orders | 50k | 400 B | 20 |
| order_items | 150k | 350 B | 52 |
| kots + events | 75k + 300k | 250 B | 94 |
| invoices + lines + taxes | 50k + 150k + 100k | 300 B | 90 |
| stock_movements | 450k | 250 B | 112 |
| domain_events | 600k | 500 B | 300 |
| **Total** | | | **≈ 0.7 GB/day** |

At that extreme volume, `domain_events` older than 90 days **and already synced** are archived to a monthly file (`events-2026-10.db`). Typical restaurants (500–2,000 orders/day) produce < 30 MB/day.

## 7. Portability to PostgreSQL / Azure SQL / MySQL

| SQLite | PostgreSQL | Notes |
|---|---|---|
| `TEXT` UUID | `uuid` | |
| `TEXT` ISO time | `timestamptz` | |
| `INTEGER` money | `bigint` | |
| `json_valid()` CHECK | `jsonb` | |
| `BEGIN IMMEDIATE` | `SELECT … FOR UPDATE` on `inventory_stock` | Handled inside the UoW adapter |
| Triggers `RAISE(ABORT)` | `RAISE EXCEPTION` triggers or REVOKE DELETE | Ported in the PG migration set |
| `STRICT` | native | |

Repositories are hand-written SQL behind the application's ports (ADR 0010). A PostgreSQL adapter implements the same ports, and the port-level tests become its acceptance suite.
