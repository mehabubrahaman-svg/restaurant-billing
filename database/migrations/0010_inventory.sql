-- Phase 2 (Stock): what the inventory module needs beyond the 0001 tables.

-- Hindi/Bengali names for the store room.
ALTER TABLE inventory_items ADD COLUMN name_translations TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(name_translations));

ALTER TABLE stock_counts ADD COLUMN notes TEXT;

-- How far each projector has read domain_events. Advanced in the same
-- transaction as the projector's writes, so every event is applied once.
CREATE TABLE projection_checkpoints (
    name            TEXT PRIMARY KEY,
    last_seq        INTEGER NOT NULL,
    updated_at      TEXT NOT NULL
) STRICT;

-- Stock starts from today: orders already in the database are not consumed again.
INSERT INTO projection_checkpoints (name, last_seq, updated_at)
SELECT 'inventory', coalesce(max(seq), 0), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM domain_events;

CREATE INDEX ix_stock_batches_item ON stock_batches(branch_id, inventory_item_id, expires_on);
CREATE INDEX ix_recipe_ingredients_item ON recipe_ingredients(inventory_item_id);
