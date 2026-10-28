-- =============================================================================
-- Delete guards for the remaining business tables.
--
-- 0001 guarded the ledgers and the main documents. This closes the gap: every
-- table with soft delete, and every other business record, now rejects a
-- physical DELETE. Still deletable on purpose, with changes captured in
-- audit_logs: configuration links (role_permissions, user_roles,
-- menu_item_addon_groups, branch_menu_items, recipe_ingredients,
-- addon_ingredients, tax_components, settings) and caches (idempotency_keys,
-- refresh_tokens, notifications). Lines of a DRAFT purchase order or stock
-- count can be removed while the document is still being edited.
-- =============================================================================

CREATE TRIGGER trg_accounts_no_delete BEFORE DELETE ON accounts
BEGIN SELECT RAISE(ABORT, 'accounts cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_addon_groups_no_delete BEFORE DELETE ON addon_groups
BEGIN SELECT RAISE(ABORT, 'addon_groups cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_addons_no_delete BEFORE DELETE ON addons
BEGIN SELECT RAISE(ABORT, 'addons cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_backups_no_delete BEFORE DELETE ON backups
BEGIN SELECT RAISE(ABORT, 'backups cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_branches_no_delete BEFORE DELETE ON branches
BEGIN SELECT RAISE(ABORT, 'branches cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_cash_shifts_no_delete BEFORE DELETE ON cash_shifts
BEGIN SELECT RAISE(ABORT, 'cash_shifts cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_categories_no_delete BEFORE DELETE ON categories
BEGIN SELECT RAISE(ABORT, 'categories cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_charge_rules_no_delete BEFORE DELETE ON charge_rules
BEGIN SELECT RAISE(ABORT, 'charge_rules cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_coupons_no_delete BEFORE DELETE ON coupons
BEGIN SELECT RAISE(ABORT, 'coupons cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_devices_no_delete BEFORE DELETE ON devices
BEGIN SELECT RAISE(ABORT, 'devices cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_dining_tables_no_delete BEFORE DELETE ON dining_tables
BEGIN SELECT RAISE(ABORT, 'dining_tables cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_document_sequences_no_delete BEFORE DELETE ON document_sequences
BEGIN SELECT RAISE(ABORT, 'document_sequences cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_floor_areas_no_delete BEFORE DELETE ON floor_areas
BEGIN SELECT RAISE(ABORT, 'floor_areas cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_grn_lines_no_delete BEFORE DELETE ON grn_lines
BEGIN SELECT RAISE(ABORT, 'grn_lines cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_indian_states_no_delete BEFORE DELETE ON indian_states
BEGIN SELECT RAISE(ABORT, 'indian_states cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_inventory_stock_no_delete BEFORE DELETE ON inventory_stock
BEGIN SELECT RAISE(ABORT, 'inventory_stock cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_invoice_charges_no_delete BEFORE DELETE ON invoice_charges
BEGIN SELECT RAISE(ABORT, 'invoice_charges cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_invoice_discounts_no_delete BEFORE DELETE ON invoice_discounts
BEGIN SELECT RAISE(ABORT, 'invoice_discounts cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_kitchen_stations_no_delete BEFORE DELETE ON kitchen_stations
BEGIN SELECT RAISE(ABORT, 'kitchen_stations cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_menu_item_variants_no_delete BEFORE DELETE ON menu_item_variants
BEGIN SELECT RAISE(ABORT, 'menu_item_variants cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_order_item_addons_no_delete BEFORE DELETE ON order_item_addons
BEGIN SELECT RAISE(ABORT, 'order_item_addons cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_organizations_no_delete BEFORE DELETE ON organizations
BEGIN SELECT RAISE(ABORT, 'organizations cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_peripherals_no_delete BEFORE DELETE ON peripherals
BEGIN SELECT RAISE(ABORT, 'peripherals cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_permissions_no_delete BEFORE DELETE ON permissions
BEGIN SELECT RAISE(ABORT, 'permissions cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_printers_no_delete BEFORE DELETE ON printers
BEGIN SELECT RAISE(ABORT, 'printers cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_recipes_no_delete BEFORE DELETE ON recipes
BEGIN SELECT RAISE(ABORT, 'recipes cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_reservations_no_delete BEFORE DELETE ON reservations
BEGIN SELECT RAISE(ABORT, 'reservations cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_roles_no_delete BEFORE DELETE ON roles
BEGIN SELECT RAISE(ABORT, 'roles cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_sales_channels_no_delete BEFORE DELETE ON sales_channels
BEGIN SELECT RAISE(ABORT, 'sales_channels cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_shift_tender_counts_no_delete BEFORE DELETE ON shift_tender_counts
BEGIN SELECT RAISE(ABORT, 'shift_tender_counts cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_staff_attendance_no_delete BEFORE DELETE ON staff_attendance
BEGIN SELECT RAISE(ABORT, 'staff_attendance cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_stock_batches_no_delete BEFORE DELETE ON stock_batches
BEGIN SELECT RAISE(ABORT, 'stock_batches cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_stock_counts_no_delete BEFORE DELETE ON stock_counts
BEGIN SELECT RAISE(ABORT, 'stock_counts cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_sync_conflicts_no_delete BEFORE DELETE ON sync_conflicts
BEGIN SELECT RAISE(ABORT, 'sync_conflicts cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_sync_queue_no_delete BEFORE DELETE ON sync_queue
BEGIN SELECT RAISE(ABORT, 'sync_queue cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_sync_state_no_delete BEFORE DELETE ON sync_state
BEGIN SELECT RAISE(ABORT, 'sync_state cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_tax_groups_no_delete BEFORE DELETE ON tax_groups
BEGIN SELECT RAISE(ABORT, 'tax_groups cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_units_no_delete BEFORE DELETE ON units
BEGIN SELECT RAISE(ABORT, 'units cannot be deleted; use soft delete or a status change'); END;

CREATE TRIGGER trg_purchase_order_lines_draft_only BEFORE DELETE ON purchase_order_lines
WHEN (SELECT status FROM purchase_orders WHERE id = OLD.purchase_order_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'purchase order lines can only be removed while the PO is a DRAFT'); END;

CREATE TRIGGER trg_stock_count_lines_draft_only BEFORE DELETE ON stock_count_lines
WHEN (SELECT status FROM stock_counts WHERE id = OLD.stock_count_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'stock count lines can only be removed while the count is a DRAFT'); END;
