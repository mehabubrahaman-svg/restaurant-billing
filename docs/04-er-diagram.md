# 04 — ER Diagrams

Mermaid ERDs render on GitHub. Split per context for readability; audit columns (`created_*`, `updated_*`, `deleted_*`, `version`) are omitted.

## 4.1 Identity, organisation, floor

```mermaid
erDiagram
  organizations ||--o{ branches : has
  organizations ||--o{ users : employs
  organizations ||--o{ roles : defines
  roles ||--o{ role_permissions : grants
  permissions ||--o{ role_permissions : "granted via"
  users ||--o{ user_roles : holds
  roles ||--o{ user_roles : "assigned in"
  branches ||--o{ user_roles : scopes
  users ||--o{ refresh_tokens : owns
  devices ||--o{ refresh_tokens : "issued to"
  branches ||--o{ devices : registers
  branches ||--o{ printers : has
  branches ||--o{ peripherals : has
  devices ||--o{ peripherals : "attached to"
  devices ||--o{ printers : drives
  branches ||--o{ settings : configures
  users ||--o{ staff_attendance : clocks
  branches ||--o{ floor_areas : has
  floor_areas ||--o{ dining_tables : contains
  dining_tables ||--o{ reservations : "booked for"

  users {
    text id PK
    text username
    text password_hash
    text pin_hash
    int is_active
  }
  roles {
    text id PK
    text code
    int is_system
  }
  permissions {
    text id PK
    text code UK
    text module
  }
  user_roles {
    text user_id PK,FK
    text role_id PK,FK
    text branch_id PK,FK
  }
  dining_tables {
    text id PK
    text label
    int seats
    text status
    text current_order_id FK
    text qr_token UK
  }
```

## 4.2 Catalog and recipes

```mermaid
erDiagram
  categories ||--o{ categories : parent
  categories ||--o{ menu_items : groups
  tax_groups ||--o{ tax_components : "split into"
  tax_groups ||--o{ menu_items : taxes
  kitchen_stations ||--o{ menu_items : "prepared at"
  menu_items ||--o{ menu_item_variants : has
  menu_items ||--o{ menu_item_addon_groups : offers
  addon_groups ||--o{ menu_item_addon_groups : "offered on"
  addon_groups ||--o{ addons : contains
  menu_items ||--o{ branch_menu_items : "priced per branch"
  menu_items ||--o{ recipes : "made by"
  menu_item_variants ||--o{ recipes : "variant recipe"
  recipes ||--o{ recipe_ingredients : uses
  inventory_items ||--o{ recipe_ingredients : "used in"
  addons ||--o{ addon_ingredients : uses
  inventory_items ||--o{ addon_ingredients : "used in"

  menu_items {
    text id PK
    text sku UK
    text name
    int base_price
    text food_type
    text tax_group_id FK
    text kitchen_station_id FK
    int is_available
  }
  recipes {
    text id PK
    text menu_item_id FK
    text variant_id FK
    int yield_portions
  }
  recipe_ingredients {
    text recipe_id FK
    text inventory_item_id FK
    int qty_milli
    int wastage_bp
  }
  tax_components {
    text tax_group_id FK
    text code
    int rate_bp
    text applies_to
  }
```

## 4.3 Ordering, kitchen, billing, CRM

```mermaid
erDiagram
  dining_tables ||--o{ orders : seats
  sales_channels ||--o{ orders : "sourced from"
  customers ||--o{ orders : places
  users ||--o{ orders : "captain of"
  orders ||--|{ order_items : contains
  menu_items ||--o{ order_items : "sold as"
  order_items ||--o{ order_item_addons : with
  orders ||--o{ kots : fires
  kitchen_stations ||--o{ kots : receives
  kots ||--o{ order_items : batches
  kots ||--o{ kot_status_events : tracks
  users ||--o{ kots : "chef assigned"
  orders ||--o{ invoices : "billed by"
  invoices ||--|{ invoice_lines : itemises
  invoices ||--o{ invoice_taxes : "tax breakup"
  invoices ||--o{ invoice_discounts : applies
  coupons ||--o{ invoice_discounts : redeems
  invoices ||--o{ invoice_charges : adds
  invoices ||--o{ payments : "settled by"
  invoices ||--o{ invoices : "credit note of"
  cash_shifts ||--o{ payments : collects
  cash_shifts ||--o{ shift_tender_counts : reconciles
  customers ||--o{ loyalty_transactions : earns
  invoices ||--o{ loyalty_transactions : generates

  sales_channels {
    text id PK
    text code
    text kind
    int commission_bp
    int gst_paid_by_operator
  }
  orders {
    text id PK
    text order_no
    int token_no
    text order_type
    text status
    text business_date
  }
  order_items {
    text id PK
    text item_name
    int unit_price
    int quantity
    text special_note
    text status
    text kot_id FK
  }
  kots {
    text id PK
    int kot_no
    text status
    text assigned_chef_id FK
    text fired_at
    text ready_at
  }
  invoices {
    text id PK
    text invoice_no UK
    text kind
    int taxable_total
    int tax_total
    int grand_total
    text status
  }
  payments {
    text id PK
    text method
    int amount
    text refund_of_payment_id FK
  }
```

## 4.4 Inventory, purchasing, accounting

```mermaid
erDiagram
  inventory_items ||--o{ inventory_stock : "balance per branch"
  inventory_items ||--o{ stock_batches : "received in"
  inventory_items ||--o{ stock_movements : "moved by"
  stock_batches ||--o{ stock_movements : "drawn from"
  stock_counts ||--|{ stock_count_lines : records
  vendors ||--o{ purchase_orders : supplies
  purchase_orders ||--|{ purchase_order_lines : lists
  vendors ||--o{ grns : delivers
  purchase_orders ||--o{ grns : "received via"
  grns ||--|{ grn_lines : lists
  purchase_order_lines ||--o{ grn_lines : fulfils
  grn_lines ||--o{ stock_batches : creates
  vendors ||--o{ vendor_payments : "paid by"
  grns ||--o{ vendor_payments : settles
  accounts ||--o{ accounts : parent
  journal_entries ||--|{ journal_lines : "balanced lines"
  accounts ||--o{ journal_lines : posts
  journal_entries ||--o{ journal_entries : reverses
  accounts ||--o{ expenses : categorises

  inventory_stock {
    text branch_id PK
    text inventory_item_id PK
    int qty_milli
    int reorder_level_milli
    int version
  }
  stock_movements {
    text id PK
    text movement_type
    int qty_milli
    int balance_after_milli
    text reference_type
    text reference_id
  }
  journal_lines {
    text journal_entry_id FK
    text account_id FK
    int debit
    int credit
    text party_type
    text party_id
  }
```

## 4.5 Platform (audit, events, sync)

```mermaid
erDiagram
  domain_events ||--o{ sync_queue : "queued for"
  sync_queue ||--o{ sync_conflicts : raises
  users ||--o{ audit_logs : "acted / approved"
  branches ||--o{ notifications : emits

  domain_events {
    int seq PK
    text id UK
    text aggregate_type
    text aggregate_id
    int aggregate_version
    text event_type
    text payload_json
  }
  sync_queue {
    text id PK
    int event_seq FK
    text status
    int attempts
    text next_attempt_at
  }
  audit_logs {
    text id PK
    text actor_id FK
    text approver_id FK
    text action
    text entity_type
    text entity_id
    text prev_hash
    text hash
  }
```
