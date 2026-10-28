# 03 — Database Design

Source of truth: [`database/migrations/0001_initial_schema.sql`](../database/migrations/0001_initial_schema.sql) and [`0002_seed_reference_data.sql`](../database/migrations/0002_seed_reference_data.sql).
The migrations are validated against SQLite 3.45 (69 tables, 33 integrity triggers, all FKs resolve).

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
| Money | `INTEGER` minor units | No floating-point drift. ₹249.50 = `24950`. |
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
| Organisation | `organizations`, `branches`, `settings`, `devices`, `printers` |
| Identity | `permissions`, `roles`, `role_permissions`, `users`, `user_roles`, `refresh_tokens`, `staff_attendance` |
| Tax | `tax_groups`, `tax_components`, `charge_rules` |
| Floor | `floor_areas`, `dining_tables`, `reservations` |
| Catalog | `kitchen_stations`, `categories`, `menu_items`, `branch_menu_items`, `menu_item_variants`, `addon_groups`, `addons`, `menu_item_addon_groups` |
| Inventory | `units`, `inventory_items`, `inventory_stock`, `stock_batches`, `recipes`, `recipe_ingredients`, `addon_ingredients`, `stock_movements`, `stock_counts`, `stock_count_lines` |
| CRM | `customers`, `loyalty_transactions` |
| Ordering & Kitchen | `orders`, `order_items`, `order_item_addons`, `kots`, `kot_status_events` |
| Billing | `document_sequences`, `coupons`, `invoices`, `invoice_lines`, `invoice_taxes`, `invoice_discounts`, `invoice_charges`, `payments`, `cash_shifts` |
| Purchasing | `vendors`, `purchase_orders`, `purchase_order_lines`, `grns`, `grn_lines`, `vendor_payments` |
| Accounting | `accounts`, `journal_entries`, `journal_lines`, `expenses` |
| Platform | `audit_logs`, `notifications`, `domain_events`, `sync_queue`, `sync_state`, `sync_conflicts`, `backups` |

**Mapping to the requested entities**: Users, Roles, Permissions ✔ · Tables → `dining_tables` (`tables` is an SQL keyword) ✔ · Orders, OrderItems ✔ · MenuItems, Categories ✔ · Inventory → `inventory_items` + `inventory_stock` ✔ · Recipes ✔ · Vendors ✔ · Purchases → `purchase_orders` + `grns` ✔ · StockMovements ✔ · Ledgers → `accounts` + `journal_*`, ledgers are views ✔ · Payments ✔ · AuditLogs ✔ · Notifications ✔ · SyncQueue ✔.

## 4. Key design decisions

### 4.1 Orders vs. KOTs vs. Invoices
- An **order** is the open tab for a table or takeaway. It collects items over time.
- A **KOT** is a batch of items fired to one kitchen station. Each "send to kitchen" creates one KOT per station. `order_items.kot_id` links each item to the KOT that fired it.
- An **invoice** is the legal document created at billing. Its lines are a frozen copy. Refunds create a **credit note** (`invoices.kind = 'CREDIT_NOTE'`, `original_invoice_id`) plus negative `payments`. Invoices are never edited.

### 4.2 Material consumption engine
On `KotFired`, the Inventory policy:
1. Resolves the active recipe for `(menu_item_id, variant_id)`, falling back to the item-level recipe.
2. Computes `qty_milli × quantity / yield_portions × (1 + wastage_bp/10000)` for each ingredient, plus addon ingredients.
3. Inserts `stock_movements(SALE_CONSUMPTION, -qty)` and updates `inventory_stock`, consuming batches FEFO (earliest expiry first).
4. If an item is cancelled after firing, a `SALE_REVERSAL` is posted, unless it's marked as wastage.

Deducting at **KOT fire** (not at payment) matches real kitchen consumption. This is configurable per branch (`settings.inventory.deduct_on = 'KOT' | 'INVOICE'`).

Example (Chicken Biryani, 1 portion): Rice 200 g → `200000`, Chicken 150 g → `150000`, Oil 20 ml → `20000`.

### 4.3 Accounting postings (auto-journal)

| Event | Debit | Credit |
|---|---|---|
| Invoice issued | Accounts Receivable (customer) | Sales; Output CGST/SGST/IGST; Service-charge income |
| Payment received | Cash / Bank / UPI clearing | Accounts Receivable |
| Credit note (refund) | Sales returns; Output tax | Cash/Bank (via negative payment) |
| GRN posted | Inventory; Input CGST/SGST | Accounts Payable (vendor) |
| Vendor payment | Accounts Payable (vendor) | Cash / Bank |
| Stock consumption (daily) | Cost of Goods Sold | Inventory |
| Wastage | Wastage expense | Inventory |
| Expense | Expense account; Input tax | Cash / Bank |

Sub-ledgers (customer, vendor) are `journal_lines.party_type/party_id`. P&L, balance sheet, and cash flow are aggregations over `v_account_ledger`.

### 4.4 Audit trail
Every command writes one `audit_logs` row (actor, approver, device, before/after JSON, reason). The hash chain (`prev_hash`, `hash`) makes tampering detectable, even by someone with direct DB access.

### 4.5 Sync readiness
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

Drizzle schema definitions live in `packages/infrastructure/src/db/schema/*` with one file per context and are kept in lock-step with the SQL migrations by a CI check (`drizzle-kit check`).
