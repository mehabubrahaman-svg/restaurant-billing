-- =============================================================================
-- RestroOS — Initial schema (SQLite 3.37+, STRICT tables)
-- =============================================================================
-- Conventions (see docs/03-database-design.md for the full rationale):
--   * Primary keys are UUIDv7 strings (time-ordered, globally unique, sync-safe).
--   * Timestamps are ISO-8601 UTC text, e.g. 2026-10-28T09:15:00.123Z.
--   * Money is INTEGER in minor units (paise/cents). Never REAL.
--   * Rates are INTEGER basis points (5% = 500).
--   * Inventory quantities are INTEGER milli-units of the item's base unit
--     (200 g of rice = 200000 when base unit is g).
--   * Business rows are never physically deleted: deleted_at/deleted_by.
--   * `version` increments on every update (optimistic locking + sync conflicts).
--   * Ledgers (stock_movements, journal_lines, payments, audit_logs,
--     domain_events) are append-only and enforced by triggers.
-- Portability: no SQLite-only features beyond STRICT/triggers, so the same
-- model maps 1:1 to PostgreSQL / Azure SQL / MySQL for cloud sync.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. ORGANISATION
-- -----------------------------------------------------------------------------

CREATE TABLE organizations (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    legal_name      TEXT,
    tax_id          TEXT,                       -- GSTIN / VAT no.
    currency_code   TEXT NOT NULL DEFAULT 'INR',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE branches (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    code            TEXT NOT NULL,              -- short code used in invoice numbers
    name            TEXT NOT NULL,
    address         TEXT,
    phone           TEXT,
    tax_id          TEXT,                       -- branch GSTIN (state specific)
    state_code      TEXT,                       -- decides CGST+SGST vs IGST
    timezone        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, code)
) STRICT;

-- Typed key/value settings per branch (receipt footer, rounding mode, ...).
CREATE TABLE settings (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT REFERENCES branches(id),   -- NULL = organisation default
    key             TEXT NOT NULL,
    value_json      TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (branch_id, key)
) STRICT;

-- Registered client devices (POS PCs, captain tablets, KDS screens).
CREATE TABLE devices (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('SERVER','POS','CAPTAIN','KDS','OWNER','TOKEN_DISPLAY','KIOSK')),
    fingerprint     TEXT NOT NULL UNIQUE,
    last_seen_at    TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE printers (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    name            TEXT NOT NULL,
    connection      TEXT NOT NULL CHECK (connection IN ('USB','NETWORK','BLUETOOTH','SYSTEM')),
    address         TEXT,                       -- IP:port, USB path, BT MAC, OS printer name
    paper_width_mm  INTEGER NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58,80)),
    purpose         TEXT NOT NULL CHECK (purpose IN ('BILL','KOT','REPORT','LABEL')),
    station_id      TEXT REFERENCES kitchen_stations(id), -- KOT printer per station
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

-- -----------------------------------------------------------------------------
-- 2. IDENTITY & ACCESS (RBAC)
-- -----------------------------------------------------------------------------

CREATE TABLE permissions (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,       -- e.g. 'bill.refund', 'order.cancel'
    module          TEXT NOT NULL,              -- e.g. 'billing'
    description     TEXT NOT NULL
) STRICT;

CREATE TABLE roles (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    code            TEXT NOT NULL,              -- ADMIN, MANAGER, CASHIER, ...
    name            TEXT NOT NULL,
    is_system       INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, code)
) STRICT;

CREATE TABLE role_permissions (
    role_id         TEXT NOT NULL REFERENCES roles(id),
    permission_id   TEXT NOT NULL REFERENCES permissions(id),
    granted_at      TEXT NOT NULL,
    granted_by      TEXT,
    PRIMARY KEY (role_id, permission_id)
) STRICT;

CREATE TABLE users (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    username        TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    password_hash   TEXT NOT NULL,              -- bcrypt, cost >= 12
    pin_hash        TEXT,                       -- bcrypt of 4-6 digit quick-switch PIN
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    failed_logins   INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT,
    last_login_at   TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    deleted_at      TEXT,
    deleted_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, username)
) STRICT;

-- A user may hold different roles in different branches.
CREATE TABLE user_roles (
    user_id         TEXT NOT NULL REFERENCES users(id),
    role_id         TEXT NOT NULL REFERENCES roles(id),
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    assigned_at     TEXT NOT NULL,
    assigned_by     TEXT,
    PRIMARY KEY (user_id, role_id, branch_id)
) STRICT;

CREATE TABLE refresh_tokens (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    device_id       TEXT REFERENCES devices(id),
    family_id       TEXT NOT NULL,              -- rotation family; reuse => revoke family
    token_hash      TEXT NOT NULL UNIQUE,       -- SHA-256 of opaque token
    expires_at      TEXT NOT NULL,
    revoked_at      TEXT,
    replaced_by     TEXT,
    created_at      TEXT NOT NULL,
    ip_address      TEXT,
    user_agent      TEXT
) STRICT;
CREATE INDEX ix_refresh_tokens_user ON refresh_tokens(user_id, revoked_at);

CREATE TABLE staff_attendance (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    user_id         TEXT NOT NULL REFERENCES users(id),
    business_date   TEXT NOT NULL,              -- YYYY-MM-DD in branch timezone
    clock_in_at     TEXT NOT NULL,
    clock_out_at    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX ix_attendance_date ON staff_attendance(branch_id, business_date);

-- -----------------------------------------------------------------------------
-- 3. TAXES & CHARGES
-- -----------------------------------------------------------------------------

CREATE TABLE tax_groups (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,              -- 'GST 5%', 'GST 18%', 'VAT 12.5%'
    is_inclusive    INTEGER NOT NULL DEFAULT 0 CHECK (is_inclusive IN (0,1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE tax_components (
    id              TEXT PRIMARY KEY,
    tax_group_id    TEXT NOT NULL REFERENCES tax_groups(id),
    code            TEXT NOT NULL,              -- CGST, SGST, IGST, VAT, CESS
    rate_bp         INTEGER NOT NULL CHECK (rate_bp >= 0),
    applies_to      TEXT NOT NULL DEFAULT 'ALWAYS' CHECK (applies_to IN ('ALWAYS','INTRA_STATE','INTER_STATE')),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (tax_group_id, code, applies_to)
) STRICT;

CREATE TABLE charge_rules (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    name            TEXT NOT NULL,              -- 'Service Charge', 'Packing Charge'
    kind            TEXT NOT NULL CHECK (kind IN ('PERCENT','FIXED')),
    value           INTEGER NOT NULL,           -- bp if PERCENT, minor units if FIXED
    order_types     TEXT NOT NULL DEFAULT '["DINE_IN"]' CHECK (json_valid(order_types)),
    tax_group_id    TEXT REFERENCES tax_groups(id),
    is_optional     INTEGER NOT NULL DEFAULT 1 CHECK (is_optional IN (0,1)),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

-- -----------------------------------------------------------------------------
-- 4. FLOOR & TABLES
-- -----------------------------------------------------------------------------

CREATE TABLE floor_areas (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    name            TEXT NOT NULL,              -- 'Ground Floor', 'Rooftop', 'AC Hall'
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE dining_tables (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    floor_area_id   TEXT NOT NULL REFERENCES floor_areas(id),
    label           TEXT NOT NULL,              -- 'T1', 'R-04'
    seats           INTEGER NOT NULL DEFAULT 4 CHECK (seats > 0),
    shape           TEXT NOT NULL DEFAULT 'SQUARE' CHECK (shape IN ('SQUARE','ROUND','RECT','BOOTH')),
    pos_x           INTEGER NOT NULL DEFAULT 0, -- layout editor grid coordinates
    pos_y           INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'AVAILABLE'
                    CHECK (status IN ('AVAILABLE','OCCUPIED','RESERVED','CLEANING','BILLING','BLOCKED')),
    current_order_id TEXT REFERENCES orders(id), -- denormalised for fast floor view
    qr_token        TEXT UNIQUE,                -- QR self-ordering token
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (branch_id, label)
) STRICT;

CREATE TABLE reservations (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    dining_table_id TEXT REFERENCES dining_tables(id),
    customer_id     TEXT REFERENCES customers(id),
    guest_name      TEXT NOT NULL,
    guest_phone     TEXT,
    party_size      INTEGER NOT NULL CHECK (party_size > 0),
    reserved_for    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','SEATED','CANCELLED','NO_SHOW')),
    notes           TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX ix_reservations_time ON reservations(branch_id, reserved_for);

-- -----------------------------------------------------------------------------
-- 5. MENU
-- -----------------------------------------------------------------------------

CREATE TABLE kitchen_stations (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    name            TEXT NOT NULL,              -- 'Tandoor', 'Chinese', 'Bar', 'Desserts'
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE categories (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    parent_id       TEXT REFERENCES categories(id),
    name            TEXT NOT NULL,
    color           TEXT,                       -- tile colour on POS grid
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE menu_items (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    category_id     TEXT NOT NULL REFERENCES categories(id),
    sku             TEXT NOT NULL,
    name            TEXT NOT NULL,
    short_name      TEXT,                       -- printed on 58mm KOT
    description     TEXT,
    food_type       TEXT NOT NULL DEFAULT 'VEG' CHECK (food_type IN ('VEG','NON_VEG','EGG','VEGAN','NA')),
    base_price      INTEGER NOT NULL CHECK (base_price >= 0),
    tax_group_id    TEXT REFERENCES tax_groups(id),
    hsn_sac_code    TEXT,
    kitchen_station_id TEXT REFERENCES kitchen_stations(id),
    prep_time_sec   INTEGER,                    -- target, used for delay alerts
    image_path      TEXT,
    is_available    INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),  -- 86'd toggle
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    deleted_at      TEXT,
    deleted_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, sku)
) STRICT;
CREATE INDEX ix_menu_items_category ON menu_items(category_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_menu_items_name ON menu_items(name COLLATE NOCASE);

-- Per-branch price/availability override (multi-branch ready).
CREATE TABLE branch_menu_items (
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    menu_item_id    TEXT NOT NULL REFERENCES menu_items(id),
    price           INTEGER CHECK (price >= 0),
    is_available    INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (branch_id, menu_item_id)
) STRICT;

CREATE TABLE menu_item_variants (
    id              TEXT PRIMARY KEY,
    menu_item_id    TEXT NOT NULL REFERENCES menu_items(id),
    name            TEXT NOT NULL,              -- 'Half', 'Full', 'Large'
    price           INTEGER NOT NULL CHECK (price >= 0),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE addon_groups (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,              -- 'Extra Toppings', 'Choice of Bread'
    min_select      INTEGER NOT NULL DEFAULT 0,
    max_select      INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    CHECK (max_select >= min_select)
) STRICT;

CREATE TABLE addons (
    id              TEXT PRIMARY KEY,
    addon_group_id  TEXT NOT NULL REFERENCES addon_groups(id),
    name            TEXT NOT NULL,
    price           INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE menu_item_addon_groups (
    menu_item_id    TEXT NOT NULL REFERENCES menu_items(id),
    addon_group_id  TEXT NOT NULL REFERENCES addon_groups(id),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (menu_item_id, addon_group_id)
) STRICT;

-- -----------------------------------------------------------------------------
-- 6. INVENTORY
-- -----------------------------------------------------------------------------

CREATE TABLE units (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,       -- g, kg, ml, l, pc, dozen
    name            TEXT NOT NULL,
    base_code       TEXT NOT NULL,              -- g | ml | pc
    to_base_milli   INTEGER NOT NULL CHECK (to_base_milli > 0)  -- 1 kg = 1000 g => 1000000 milli
) STRICT;

CREATE TABLE inventory_items (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    sku             TEXT NOT NULL,
    name            TEXT NOT NULL,
    category        TEXT,                       -- 'Grains', 'Meat', 'Dairy'
    base_unit_code  TEXT NOT NULL CHECK (base_unit_code IN ('g','ml','pc')),
    purchase_unit_id TEXT REFERENCES units(id),
    is_perishable   INTEGER NOT NULL DEFAULT 0 CHECK (is_perishable IN (0,1)),
    shelf_life_days INTEGER,
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    deleted_at      TEXT,
    deleted_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, sku)
) STRICT;

-- Current balance per branch. Updated in the SAME transaction as the
-- stock_movements insert; `version` guards concurrent writers.
CREATE TABLE inventory_stock (
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
    qty_milli       INTEGER NOT NULL DEFAULT 0,
    avg_cost_per_base INTEGER NOT NULL DEFAULT 0, -- minor units per 1000 base units (weighted avg)
    reorder_level_milli INTEGER NOT NULL DEFAULT 0,
    max_level_milli INTEGER,                    -- overstock threshold
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (branch_id, inventory_item_id)
) STRICT;

-- Batches for expiry tracking (FEFO consumption).
CREATE TABLE stock_batches (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
    grn_line_id     TEXT REFERENCES grn_lines(id),
    batch_no        TEXT,
    expires_on      TEXT,                       -- YYYY-MM-DD
    received_qty_milli INTEGER NOT NULL CHECK (received_qty_milli > 0),
    remaining_qty_milli INTEGER NOT NULL CHECK (remaining_qty_milli >= 0),
    unit_cost_per_base INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX ix_batches_expiry ON stock_batches(branch_id, expires_on) WHERE remaining_qty_milli > 0;

-- Recipe (bill of materials) for a menu item or one of its variants.
CREATE TABLE recipes (
    id              TEXT PRIMARY KEY,
    menu_item_id    TEXT NOT NULL REFERENCES menu_items(id),
    variant_id      TEXT REFERENCES menu_item_variants(id),
    yield_portions  INTEGER NOT NULL DEFAULT 1 CHECK (yield_portions > 0),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE UNIQUE INDEX ux_recipes_active ON recipes(menu_item_id, IFNULL(variant_id, ''))
    WHERE is_active = 1 AND deleted_at IS NULL;

CREATE TABLE recipe_ingredients (
    id              TEXT PRIMARY KEY,
    recipe_id       TEXT NOT NULL REFERENCES recipes(id),
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
    qty_milli       INTEGER NOT NULL CHECK (qty_milli > 0), -- per yield_portions
    wastage_bp      INTEGER NOT NULL DEFAULT 0,             -- expected trim loss
    UNIQUE (recipe_id, inventory_item_id)
) STRICT;

-- Addons can consume stock too (extra cheese = 30 g cheese).
CREATE TABLE addon_ingredients (
    id              TEXT PRIMARY KEY,
    addon_id        TEXT NOT NULL REFERENCES addons(id),
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
    qty_milli       INTEGER NOT NULL CHECK (qty_milli > 0),
    UNIQUE (addon_id, inventory_item_id)
) STRICT;

-- Immutable stock ledger. Every change to inventory_stock has a row here.
CREATE TABLE stock_movements (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
    batch_id        TEXT REFERENCES stock_batches(id),
    movement_type   TEXT NOT NULL CHECK (movement_type IN (
                        'OPENING','PURCHASE','SALE_CONSUMPTION','SALE_REVERSAL',
                        'WASTAGE','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','RETURN_TO_VENDOR')),
    qty_milli       INTEGER NOT NULL CHECK (qty_milli <> 0),   -- signed: + in, - out
    balance_after_milli INTEGER NOT NULL,
    unit_cost_per_base INTEGER NOT NULL DEFAULT 0,
    reference_type  TEXT,                       -- 'ORDER_ITEM','GRN_LINE','STOCK_COUNT',...
    reference_id    TEXT,
    reason          TEXT,
    business_date   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    created_by      TEXT
) STRICT;
CREATE INDEX ix_stock_mov_item_date ON stock_movements(branch_id, inventory_item_id, business_date);
CREATE INDEX ix_stock_mov_ref ON stock_movements(reference_type, reference_id);

-- Physical stock counts (opening / closing / spot checks).
CREATE TABLE stock_counts (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    count_type      TEXT NOT NULL CHECK (count_type IN ('OPENING','CLOSING','SPOT')),
    business_date   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
    posted_at       TEXT,
    posted_by       TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE stock_count_lines (
    id              TEXT PRIMARY KEY,
    stock_count_id  TEXT NOT NULL REFERENCES stock_counts(id),
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
    system_qty_milli INTEGER NOT NULL,
    counted_qty_milli INTEGER NOT NULL,
    UNIQUE (stock_count_id, inventory_item_id)
) STRICT;

-- -----------------------------------------------------------------------------
-- 7. CUSTOMERS / CRM
-- -----------------------------------------------------------------------------

CREATE TABLE customers (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    phone           TEXT NOT NULL,              -- E.164
    name            TEXT,
    email           TEXT,
    birthday        TEXT,
    anniversary     TEXT,
    tax_id          TEXT,                       -- B2B GSTIN for tax invoices
    credit_limit    INTEGER NOT NULL DEFAULT 0,
    loyalty_points  INTEGER NOT NULL DEFAULT 0, -- cached balance; source of truth = loyalty_transactions
    membership_tier TEXT,
    visit_count     INTEGER NOT NULL DEFAULT 0, -- cached; recomputable from invoices
    lifetime_value  INTEGER NOT NULL DEFAULT 0, -- cached minor units
    last_visit_at   TEXT,
    marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0,1)),
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    deleted_at      TEXT,
    deleted_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, phone)
) STRICT;

CREATE TABLE loyalty_transactions (
    id              TEXT PRIMARY KEY,
    customer_id     TEXT NOT NULL REFERENCES customers(id),
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    invoice_id      TEXT REFERENCES invoices(id),
    kind            TEXT NOT NULL CHECK (kind IN ('EARN','REDEEM','EXPIRE','ADJUST')),
    points          INTEGER NOT NULL,           -- signed
    created_at      TEXT NOT NULL,
    created_by      TEXT
) STRICT;

-- -----------------------------------------------------------------------------
-- 8. ORDERS & KITCHEN
-- -----------------------------------------------------------------------------

CREATE TABLE orders (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    order_no        TEXT NOT NULL,              -- human readable, per branch per day
    token_no        INTEGER,                    -- token display for takeaway / QSR
    business_date   TEXT NOT NULL,
    order_type      TEXT NOT NULL CHECK (order_type IN ('DINE_IN','TAKEAWAY','DELIVERY','QR_SELF','KIOSK')),
    source          TEXT NOT NULL DEFAULT 'POS' CHECK (source IN ('POS','CAPTAIN','QR','KIOSK','ONLINE')),
    dining_table_id TEXT REFERENCES dining_tables(id),
    customer_id     TEXT REFERENCES customers(id),
    captain_id      TEXT REFERENCES users(id),
    covers          INTEGER CHECK (covers > 0),
    status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('PENDING_APPROVAL','OPEN','BILLED','PAID','CANCELLED','VOID')),
    notes           TEXT,
    subtotal        INTEGER NOT NULL DEFAULT 0, -- running totals, recomputed on change
    opened_at       TEXT NOT NULL,
    closed_at       TEXT,
    cancel_reason   TEXT,
    cancelled_by    TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (branch_id, business_date, order_no)
) STRICT;
CREATE INDEX ix_orders_open ON orders(branch_id, status) WHERE status = 'OPEN';
CREATE INDEX ix_orders_date ON orders(branch_id, business_date);
CREATE INDEX ix_orders_table ON orders(dining_table_id) WHERE status = 'OPEN';
CREATE INDEX ix_orders_customer ON orders(customer_id);

CREATE TABLE order_items (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL REFERENCES orders(id),
    menu_item_id    TEXT NOT NULL REFERENCES menu_items(id),
    variant_id      TEXT REFERENCES menu_item_variants(id),
    -- snapshots: price/name/tax frozen at order time
    item_name       TEXT NOT NULL,
    variant_name    TEXT,
    unit_price      INTEGER NOT NULL CHECK (unit_price >= 0),
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    addons_total    INTEGER NOT NULL DEFAULT 0, -- per unit
    line_total      INTEGER NOT NULL,           -- (unit_price + addons_total) * quantity
    tax_group_id    TEXT REFERENCES tax_groups(id),
    special_note    TEXT,                       -- 'Less spicy'
    seat_no         INTEGER,
    course          INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','SENT','PREPARING','READY','SERVED','CANCELLED')),
    kot_id          TEXT REFERENCES kots(id),  -- set when fired
    is_complimentary INTEGER NOT NULL DEFAULT 0 CHECK (is_complimentary IN (0,1)),
    cancel_reason   TEXT,
    cancelled_by    TEXT REFERENCES users(id),
    cancelled_at    TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX ix_order_items_order ON order_items(order_id);
CREATE INDEX ix_order_items_kot ON order_items(kot_id);

CREATE TABLE order_item_addons (
    id              TEXT PRIMARY KEY,
    order_item_id   TEXT NOT NULL REFERENCES order_items(id),
    addon_id        TEXT NOT NULL REFERENCES addons(id),
    addon_name      TEXT NOT NULL,              -- snapshot
    price           INTEGER NOT NULL,           -- snapshot, per unit of parent
    quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0)
) STRICT;

-- Kitchen Order Ticket: a batch of items fired to one station.
CREATE TABLE kots (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    order_id        TEXT NOT NULL REFERENCES orders(id),
    kitchen_station_id TEXT REFERENCES kitchen_stations(id),
    kot_no          INTEGER NOT NULL,           -- sequential per branch per day
    business_date   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'NEW'
                    CHECK (status IN ('NEW','ACCEPTED','COOKING','READY','SERVED','CANCELLED')),
    priority        INTEGER NOT NULL DEFAULT 0,
    assigned_chef_id TEXT REFERENCES users(id),
    fired_at        TEXT NOT NULL,
    accepted_at     TEXT,
    cooking_at      TEXT,
    ready_at        TEXT,
    served_at       TEXT,
    target_ready_at TEXT,                       -- fired_at + max(prep_time) => delay alerts
    printed_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (branch_id, business_date, kot_no)
) STRICT;
CREATE INDEX ix_kots_active ON kots(branch_id, status) WHERE status IN ('NEW','ACCEPTED','COOKING','READY');
CREATE INDEX ix_kots_chef ON kots(assigned_chef_id, business_date);

-- Append-only status trail for KDS metrics (cook time per chef etc.).
CREATE TABLE kot_status_events (
    id              TEXT PRIMARY KEY,
    kot_id          TEXT NOT NULL REFERENCES kots(id),
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    actor_id        TEXT REFERENCES users(id),
    occurred_at     TEXT NOT NULL
) STRICT;
CREATE INDEX ix_kot_events_kot ON kot_status_events(kot_id);

-- -----------------------------------------------------------------------------
-- 9. BILLING & PAYMENTS
-- -----------------------------------------------------------------------------

-- Gapless invoice numbering per branch + fiscal year + series (GST requirement).
CREATE TABLE document_sequences (
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    series          TEXT NOT NULL,              -- 'INV', 'CN' (credit note), 'PO', 'GRN'
    fiscal_year     TEXT NOT NULL,              -- '2026-27'
    next_value      INTEGER NOT NULL DEFAULT 1,
    prefix          TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (branch_id, series, fiscal_year)
) STRICT;

CREATE TABLE coupons (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    code            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('PERCENT','FIXED')),
    value           INTEGER NOT NULL CHECK (value > 0),
    max_discount    INTEGER,
    min_bill        INTEGER NOT NULL DEFAULT 0,
    valid_from      TEXT,
    valid_to        TEXT,
    usage_limit     INTEGER,
    used_count      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, code)
) STRICT;

CREATE TABLE invoices (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    order_id        TEXT NOT NULL REFERENCES orders(id),
    invoice_no      TEXT NOT NULL,              -- e.g. BLR1/2026-27/000123
    kind            TEXT NOT NULL DEFAULT 'INVOICE' CHECK (kind IN ('INVOICE','CREDIT_NOTE')),
    original_invoice_id TEXT REFERENCES invoices(id),   -- for credit notes (refunds)
    business_date   TEXT NOT NULL,
    fiscal_year     TEXT NOT NULL,
    customer_id     TEXT REFERENCES customers(id),
    customer_tax_id TEXT,                       -- snapshot (B2B)
    place_of_supply TEXT,                       -- state code
    subtotal        INTEGER NOT NULL,           -- sum of line totals before discount
    discount_total  INTEGER NOT NULL DEFAULT 0,
    charges_total   INTEGER NOT NULL DEFAULT 0,
    taxable_total   INTEGER NOT NULL,
    tax_total       INTEGER NOT NULL,
    round_off       INTEGER NOT NULL DEFAULT 0,
    grand_total     INTEGER NOT NULL,
    paid_total      INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'UNPAID'
                    CHECK (status IN ('UNPAID','PARTIALLY_PAID','PAID','CREDIT','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
    print_count     INTEGER NOT NULL DEFAULT 0,
    cancel_reason   TEXT,
    cancelled_by    TEXT REFERENCES users(id),
    cancelled_at    TEXT,
    approved_by     TEXT REFERENCES users(id),  -- manager override for discount/cancel
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (branch_id, invoice_no)
) STRICT;
CREATE INDEX ix_invoices_date ON invoices(branch_id, business_date);
CREATE INDEX ix_invoices_order ON invoices(order_id);
CREATE INDEX ix_invoices_customer ON invoices(customer_id);

-- Frozen copy of what was billed (legal document; never recomputed).
CREATE TABLE invoice_lines (
    id              TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL REFERENCES invoices(id),
    order_item_id   TEXT REFERENCES order_items(id),
    description     TEXT NOT NULL,
    hsn_sac_code    TEXT,
    quantity        INTEGER NOT NULL,
    unit_price      INTEGER NOT NULL,
    discount        INTEGER NOT NULL DEFAULT 0,
    taxable_value   INTEGER NOT NULL,
    tax_amount      INTEGER NOT NULL,
    line_total      INTEGER NOT NULL
) STRICT;
CREATE INDEX ix_invoice_lines_invoice ON invoice_lines(invoice_id);

CREATE TABLE invoice_taxes (
    id              TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL REFERENCES invoices(id),
    tax_code        TEXT NOT NULL,              -- CGST / SGST / IGST / VAT / CESS
    rate_bp         INTEGER NOT NULL,
    taxable_value   INTEGER NOT NULL,
    tax_amount      INTEGER NOT NULL
) STRICT;
CREATE INDEX ix_invoice_taxes_invoice ON invoice_taxes(invoice_id);

CREATE TABLE invoice_discounts (
    id              TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL REFERENCES invoices(id),
    kind            TEXT NOT NULL CHECK (kind IN ('PERCENT','FIXED','COUPON','LOYALTY','COMPLIMENTARY')),
    coupon_id       TEXT REFERENCES coupons(id),
    value           INTEGER NOT NULL,           -- bp or minor units per kind
    amount          INTEGER NOT NULL,           -- resolved minor units
    reason          TEXT,
    approved_by     TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id)
) STRICT;

CREATE TABLE invoice_charges (
    id              TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL REFERENCES invoices(id),
    charge_rule_id  TEXT REFERENCES charge_rules(id),
    name            TEXT NOT NULL,
    amount          INTEGER NOT NULL
) STRICT;

-- Immutable. A refund is a new negative payment row, never an edit.
CREATE TABLE payments (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    invoice_id      TEXT NOT NULL REFERENCES invoices(id),
    method          TEXT NOT NULL CHECK (method IN ('CASH','CARD','UPI','WALLET','CREDIT','COMPLIMENTARY','LOYALTY')),
    amount          INTEGER NOT NULL CHECK (amount <> 0),  -- negative = refund
    tendered        INTEGER,                    -- cash given by customer
    change_due      INTEGER,
    reference       TEXT,                       -- card auth code / UPI RRN
    refund_of_payment_id TEXT REFERENCES payments(id),
    business_date   TEXT NOT NULL,
    shift_id        TEXT REFERENCES cash_shifts(id),
    approved_by     TEXT REFERENCES users(id),  -- required for refunds
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX ix_payments_invoice ON payments(invoice_id);
CREATE INDEX ix_payments_date ON payments(branch_id, business_date, method);

-- Cash drawer shifts (opening float, closing count, variance).
CREATE TABLE cash_shifts (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    device_id       TEXT REFERENCES devices(id),
    opened_by       TEXT NOT NULL REFERENCES users(id),
    opened_at       TEXT NOT NULL,
    opening_float   INTEGER NOT NULL DEFAULT 0,
    closed_by       TEXT REFERENCES users(id),
    closed_at       TEXT,
    expected_cash   INTEGER,
    counted_cash    INTEGER,
    variance        INTEGER,
    status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

-- -----------------------------------------------------------------------------
-- 10. VENDORS & PURCHASING
-- -----------------------------------------------------------------------------

CREATE TABLE vendors (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    contact_person  TEXT,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    tax_id          TEXT,
    payment_terms_days INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    deleted_at      TEXT,
    deleted_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, code)
) STRICT;

CREATE TABLE purchase_orders (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    vendor_id       TEXT NOT NULL REFERENCES vendors(id),
    po_no           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
    expected_on     TEXT,
    subtotal        INTEGER NOT NULL DEFAULT 0,
    tax_total       INTEGER NOT NULL DEFAULT 0,
    grand_total     INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    approved_by     TEXT REFERENCES users(id),
    approved_at     TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (branch_id, po_no)
) STRICT;

CREATE TABLE purchase_order_lines (
    id              TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
    unit_id         TEXT NOT NULL REFERENCES units(id),
    quantity_milli  INTEGER NOT NULL CHECK (quantity_milli > 0),  -- in purchase unit
    unit_price      INTEGER NOT NULL CHECK (unit_price >= 0),     -- per purchase unit
    tax_rate_bp     INTEGER NOT NULL DEFAULT 0,
    received_qty_milli INTEGER NOT NULL DEFAULT 0
) STRICT;

-- Goods Received Note
CREATE TABLE grns (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    vendor_id       TEXT NOT NULL REFERENCES vendors(id),
    purchase_order_id TEXT REFERENCES purchase_orders(id),
    grn_no          TEXT NOT NULL,
    vendor_invoice_no TEXT,
    vendor_invoice_date TEXT,
    business_date   TEXT NOT NULL,
    subtotal        INTEGER NOT NULL DEFAULT 0,
    tax_total       INTEGER NOT NULL DEFAULT 0,
    grand_total     INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','CANCELLED')),
    posted_at       TEXT,
    posted_by       TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (branch_id, grn_no)
) STRICT;

CREATE TABLE grn_lines (
    id              TEXT PRIMARY KEY,
    grn_id          TEXT NOT NULL REFERENCES grns(id),
    purchase_order_line_id TEXT REFERENCES purchase_order_lines(id),
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
    unit_id         TEXT NOT NULL REFERENCES units(id),
    quantity_milli  INTEGER NOT NULL CHECK (quantity_milli > 0),
    rejected_qty_milli INTEGER NOT NULL DEFAULT 0,
    unit_price      INTEGER NOT NULL,
    tax_rate_bp     INTEGER NOT NULL DEFAULT 0,
    batch_no        TEXT,
    expires_on      TEXT
) STRICT;

CREATE TABLE vendor_payments (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    vendor_id       TEXT NOT NULL REFERENCES vendors(id),
    grn_id          TEXT REFERENCES grns(id),   -- NULL = on-account payment
    method          TEXT NOT NULL CHECK (method IN ('CASH','BANK','UPI','CHEQUE')),
    amount          INTEGER NOT NULL CHECK (amount > 0),
    reference       TEXT,
    paid_on         TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id)
) STRICT;

-- -----------------------------------------------------------------------------
-- 11. ACCOUNTING (double entry)
-- -----------------------------------------------------------------------------

CREATE TABLE accounts (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    code            TEXT NOT NULL,              -- '1000', '4000', ...
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
    parent_id       TEXT REFERENCES accounts(id),
    system_tag      TEXT,                       -- 'CASH','BANK','SALES','OUTPUT_CGST','INVENTORY','AP',...
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, code)
) STRICT;

CREATE TABLE journal_entries (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    entry_no        TEXT NOT NULL,
    entry_date      TEXT NOT NULL,
    source_type     TEXT NOT NULL CHECK (source_type IN ('INVOICE','CREDIT_NOTE','PAYMENT','GRN','VENDOR_PAYMENT','EXPENSE','STOCK_ADJUSTMENT','MANUAL')),
    source_id       TEXT,
    narration       TEXT,
    reversal_of_id  TEXT REFERENCES journal_entries(id),  -- corrections are reversals, never edits
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    UNIQUE (branch_id, entry_no)
) STRICT;
CREATE INDEX ix_journal_source ON journal_entries(source_type, source_id);
CREATE INDEX ix_journal_date ON journal_entries(branch_id, entry_date);

CREATE TABLE journal_lines (
    id              TEXT PRIMARY KEY,
    journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
    account_id      TEXT NOT NULL REFERENCES accounts(id),
    debit           INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit          INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
    party_type      TEXT CHECK (party_type IN ('CUSTOMER','VENDOR','EMPLOYEE')),  -- sub-ledgers
    party_id        TEXT,
    memo            TEXT,
    CHECK ((debit = 0) <> (credit = 0))         -- exactly one side non-zero
) STRICT;
CREATE INDEX ix_journal_lines_account ON journal_lines(account_id);
CREATE INDEX ix_journal_lines_party ON journal_lines(party_type, party_id);

CREATE TABLE expenses (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    expense_account_id TEXT NOT NULL REFERENCES accounts(id),
    paid_from_account_id TEXT NOT NULL REFERENCES accounts(id),
    amount          INTEGER NOT NULL CHECK (amount > 0),
    tax_amount      INTEGER NOT NULL DEFAULT 0,
    description     TEXT NOT NULL,
    expense_date    TEXT NOT NULL,
    attachment_path TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id),
    deleted_at      TEXT,
    deleted_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

-- -----------------------------------------------------------------------------
-- 12. CROSS-CUTTING: AUDIT, NOTIFICATIONS, EVENTS, SYNC
-- -----------------------------------------------------------------------------

CREATE TABLE audit_logs (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT REFERENCES branches(id),
    actor_id        TEXT REFERENCES users(id),
    approver_id     TEXT REFERENCES users(id),  -- manager who authorised (refund, void, discount)
    device_id       TEXT,
    action          TEXT NOT NULL,              -- 'order.item.cancel', 'invoice.refund', ...
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    before_json     TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json      TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
    reason          TEXT,
    ip_address      TEXT,
    occurred_at     TEXT NOT NULL,
    prev_hash       TEXT,                       -- hash chain => tamper evidence
    hash            TEXT NOT NULL
) STRICT;
CREATE INDEX ix_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX ix_audit_actor ON audit_logs(actor_id, occurred_at);
CREATE INDEX ix_audit_time ON audit_logs(branch_id, occurred_at);

CREATE TABLE notifications (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    user_id         TEXT REFERENCES users(id),  -- NULL = broadcast to role
    role_code       TEXT,
    kind            TEXT NOT NULL,              -- LOW_STOCK, EXPIRING, KOT_DELAYED, ORDER_READY, ...
    severity        TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','CRITICAL')),
    title           TEXT NOT NULL,
    body            TEXT,
    entity_type     TEXT,
    entity_id       TEXT,
    read_at         TEXT,
    created_at      TEXT NOT NULL
) STRICT;
CREATE INDEX ix_notifications_user ON notifications(user_id, read_at);

-- Event store: every state-changing command emits domain events here
-- (same transaction). Feeds realtime push, projections and the sync queue.
CREATE TABLE domain_events (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,   -- local total order
    id              TEXT NOT NULL UNIQUE,                -- UUIDv7, global identity
    branch_id       TEXT NOT NULL,
    aggregate_type  TEXT NOT NULL,              -- 'Order', 'Kot', 'Invoice', ...
    aggregate_id    TEXT NOT NULL,
    aggregate_version INTEGER NOT NULL,
    event_type      TEXT NOT NULL,              -- 'OrderItemAdded', 'KotStatusChanged', ...
    payload_json    TEXT NOT NULL CHECK (json_valid(payload_json)),
    metadata_json   TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)), -- actor, device, correlation id
    occurred_at     TEXT NOT NULL
) STRICT;
CREATE INDEX ix_events_aggregate ON domain_events(aggregate_type, aggregate_id, aggregate_version);

-- Outbox for cloud sync (transactional outbox pattern).
CREATE TABLE sync_queue (
    id              TEXT PRIMARY KEY,
    event_seq       INTEGER NOT NULL REFERENCES domain_events(seq),
    branch_id       TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    operation       TEXT NOT NULL CHECK (operation IN ('UPSERT','APPEND')),
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_FLIGHT','SYNCED','FAILED','CONFLICT')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,              -- exponential backoff
    last_error      TEXT,
    synced_at       TEXT,
    created_at      TEXT NOT NULL
) STRICT;
CREATE INDEX ix_sync_pending ON sync_queue(status, next_attempt_at) WHERE status IN ('PENDING','FAILED');

CREATE TABLE sync_state (
    id              TEXT PRIMARY KEY,           -- 'cloud:primary'
    last_pushed_seq INTEGER NOT NULL DEFAULT 0,
    last_pulled_cursor TEXT,
    last_success_at TEXT,
    updated_at      TEXT NOT NULL
) STRICT;

CREATE TABLE sync_conflicts (
    id              TEXT PRIMARY KEY,
    sync_queue_id   TEXT NOT NULL REFERENCES sync_queue(id),
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    local_json      TEXT NOT NULL,
    remote_json     TEXT NOT NULL,
    resolution      TEXT CHECK (resolution IN ('LOCAL_WINS','REMOTE_WINS','MERGED','MANUAL')),
    resolved_by     TEXT,
    resolved_at     TEXT,
    created_at      TEXT NOT NULL
) STRICT;

CREATE TABLE backups (
    id              TEXT PRIMARY KEY,
    file_path       TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    sha256          TEXT NOT NULL,
    is_encrypted    INTEGER NOT NULL DEFAULT 1 CHECK (is_encrypted IN (0,1)),
    kind            TEXT NOT NULL CHECK (kind IN ('SCHEDULED','MANUAL','PRE_MIGRATION')),
    created_at      TEXT NOT NULL,
    created_by      TEXT
) STRICT;

-- -----------------------------------------------------------------------------
-- 13. INTEGRITY TRIGGERS
-- -----------------------------------------------------------------------------

-- Append-only ledgers: no UPDATE, no DELETE.
CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;
CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;

CREATE TRIGGER trg_journal_entries_no_update BEFORE UPDATE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal_entries is append-only; post a reversal'); END;
CREATE TRIGGER trg_journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal_entries is append-only; post a reversal'); END;
CREATE TRIGGER trg_journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal_lines is append-only'); END;
CREATE TRIGGER trg_journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal_lines is append-only'); END;

CREATE TRIGGER trg_payments_no_update BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'payments is append-only; refunds are new rows'); END;
CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'payments is append-only'); END;

CREATE TRIGGER trg_domain_events_no_update BEFORE UPDATE ON domain_events
BEGIN SELECT RAISE(ABORT, 'domain_events is append-only'); END;
CREATE TRIGGER trg_domain_events_no_delete BEFORE DELETE ON domain_events
BEGIN SELECT RAISE(ABORT, 'domain_events is append-only'); END;

CREATE TRIGGER trg_kot_events_no_update BEFORE UPDATE ON kot_status_events
BEGIN SELECT RAISE(ABORT, 'kot_status_events is append-only'); END;
CREATE TRIGGER trg_kot_events_no_delete BEFORE DELETE ON kot_status_events
BEGIN SELECT RAISE(ABORT, 'kot_status_events is append-only'); END;

CREATE TRIGGER trg_loyalty_no_update BEFORE UPDATE ON loyalty_transactions
BEGIN SELECT RAISE(ABORT, 'loyalty_transactions is append-only'); END;
CREATE TRIGGER trg_loyalty_no_delete BEFORE DELETE ON loyalty_transactions
BEGIN SELECT RAISE(ABORT, 'loyalty_transactions is append-only'); END;

-- Billed documents are legal records: never physically deleted.
CREATE TRIGGER trg_invoices_no_delete BEFORE DELETE ON invoices
BEGIN SELECT RAISE(ABORT, 'invoices cannot be deleted; cancel or issue a credit note'); END;
CREATE TRIGGER trg_invoice_lines_no_delete BEFORE DELETE ON invoice_lines
BEGIN SELECT RAISE(ABORT, 'invoice_lines cannot be deleted'); END;
CREATE TRIGGER trg_invoice_lines_no_update BEFORE UPDATE ON invoice_lines
BEGIN SELECT RAISE(ABORT, 'invoice_lines are frozen'); END;
CREATE TRIGGER trg_invoice_taxes_no_delete BEFORE DELETE ON invoice_taxes
BEGIN SELECT RAISE(ABORT, 'invoice_taxes cannot be deleted'); END;
CREATE TRIGGER trg_invoice_taxes_no_update BEFORE UPDATE ON invoice_taxes
BEGIN SELECT RAISE(ABORT, 'invoice_taxes are frozen'); END;

-- Operational records use status/soft delete instead of DELETE.
CREATE TRIGGER trg_orders_no_delete BEFORE DELETE ON orders
BEGIN SELECT RAISE(ABORT, 'orders cannot be deleted; cancel instead'); END;
CREATE TRIGGER trg_order_items_no_delete BEFORE DELETE ON order_items
BEGIN SELECT RAISE(ABORT, 'order_items cannot be deleted; cancel instead'); END;
CREATE TRIGGER trg_kots_no_delete BEFORE DELETE ON kots
BEGIN SELECT RAISE(ABORT, 'kots cannot be deleted; cancel instead'); END;
CREATE TRIGGER trg_users_no_delete BEFORE DELETE ON users
BEGIN SELECT RAISE(ABORT, 'users cannot be deleted; set deleted_at'); END;
CREATE TRIGGER trg_menu_items_no_delete BEFORE DELETE ON menu_items
BEGIN SELECT RAISE(ABORT, 'menu_items cannot be deleted; set deleted_at'); END;
CREATE TRIGGER trg_customers_no_delete BEFORE DELETE ON customers
BEGIN SELECT RAISE(ABORT, 'customers cannot be deleted; set deleted_at'); END;
CREATE TRIGGER trg_vendors_no_delete BEFORE DELETE ON vendors
BEGIN SELECT RAISE(ABORT, 'vendors cannot be deleted; set deleted_at'); END;
CREATE TRIGGER trg_inventory_items_no_delete BEFORE DELETE ON inventory_items
BEGIN SELECT RAISE(ABORT, 'inventory_items cannot be deleted; set deleted_at'); END;
CREATE TRIGGER trg_purchase_orders_no_delete BEFORE DELETE ON purchase_orders
BEGIN SELECT RAISE(ABORT, 'purchase_orders cannot be deleted; cancel instead'); END;
CREATE TRIGGER trg_grns_no_delete BEFORE DELETE ON grns
BEGIN SELECT RAISE(ABORT, 'grns cannot be deleted; cancel instead'); END;
CREATE TRIGGER trg_vendor_payments_no_delete BEFORE DELETE ON vendor_payments
BEGIN SELECT RAISE(ABORT, 'vendor_payments cannot be deleted'); END;
CREATE TRIGGER trg_expenses_no_delete BEFORE DELETE ON expenses
BEGIN SELECT RAISE(ABORT, 'expenses cannot be deleted; set deleted_at'); END;

-- Journal entries must balance. Checked when the entry's lines are complete:
-- the application inserts lines then calls the posting command, which
-- verifies with this view inside the same transaction before COMMIT.
CREATE VIEW v_unbalanced_journal_entries AS
SELECT je.id, SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
FROM journal_entries je
JOIN journal_lines jl ON jl.journal_entry_id = je.id
GROUP BY je.id
HAVING SUM(jl.debit) <> SUM(jl.credit);

-- -----------------------------------------------------------------------------
-- 14. REPORTING VIEWS (ledgers are projections over journal_lines)
-- -----------------------------------------------------------------------------

CREATE VIEW v_account_ledger AS
SELECT jl.account_id, je.branch_id, je.entry_date, je.entry_no, je.source_type, je.source_id,
       jl.debit, jl.credit, jl.party_type, jl.party_id, COALESCE(jl.memo, je.narration) AS narration
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id;

CREATE VIEW v_vendor_dues AS
SELECT v.id AS vendor_id, v.name,
       COALESCE((SELECT SUM(g.grand_total) FROM grns g WHERE g.vendor_id = v.id AND g.status = 'POSTED'), 0)
     - COALESCE((SELECT SUM(p.amount) FROM vendor_payments p WHERE p.vendor_id = v.id), 0) AS due
FROM vendors v
WHERE v.deleted_at IS NULL;

CREATE VIEW v_low_stock AS
SELECT s.branch_id, i.id AS inventory_item_id, i.name, i.base_unit_code,
       s.qty_milli, s.reorder_level_milli
FROM inventory_stock s
JOIN inventory_items i ON i.id = s.inventory_item_id
WHERE i.deleted_at IS NULL AND s.qty_milli <= s.reorder_level_milli;

CREATE VIEW v_daily_sales AS
SELECT branch_id, business_date,
       COUNT(*)            AS invoice_count,
       SUM(subtotal)       AS gross_sales,
       SUM(discount_total) AS discounts,
       SUM(tax_total)      AS taxes,
       SUM(grand_total)    AS net_sales
FROM invoices
WHERE kind = 'INVOICE' AND status NOT IN ('CANCELLED')
GROUP BY branch_id, business_date;
