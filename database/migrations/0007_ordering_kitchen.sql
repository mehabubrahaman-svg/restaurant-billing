-- 0007: ordering and kitchen (Sprint 4).

-- MERGE moves a table's items into another table's open order; the emptied
-- order is closed and points at the order it joined.
ALTER TABLE orders ADD COLUMN merged_into_order_id TEXT REFERENCES orders(id);

-- A cancelled item that was already cooked is thrown away: Phase 2 books it
-- as wastage instead of returning the ingredients to stock.
ALTER TABLE order_items ADD COLUMN is_wastage INTEGER NOT NULL DEFAULT 0 CHECK (is_wastage IN (0,1));
-- Item-level bump on the KDS.
ALTER TABLE order_items ADD COLUMN ready_at TEXT;
-- Station is decided when the item is fired (the menu may move it later).
ALTER TABLE order_items ADD COLUMN kitchen_station_id TEXT REFERENCES kitchen_stations(id);
-- Food mark copied at order time, for the KDS and the bill.
ALTER TABLE order_items ADD COLUMN food_type TEXT NOT NULL DEFAULT 'NA'
    CHECK (food_type IN ('VEG','NON_VEG','EGG','VEGAN','NA'));

CREATE INDEX ix_orders_token ON orders(branch_id, business_date, token_no) WHERE token_no IS NOT NULL;
CREATE INDEX ix_kots_order ON kots(order_id);
