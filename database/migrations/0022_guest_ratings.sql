-- Guest ratings and published bestsellers (docs/03, migration list).
--
-- A captain can put the guest's phone on a table order (orders.customer_id,
-- through the customers table). The same day, the guest finds the order on
-- the table's QR page by that phone and rates the captain and each dish, once
-- per order. An admin reads every rating, chooses which dish ratings count
-- toward the stars guests see on the menu, and publishes the bestsellers.

INSERT INTO permissions (id, code, module, description) VALUES
  ('perm-043', 'feedback.manage', 'crm', 'Read guest ratings, choose which count for dishes, publish bestsellers');

-- Existing restaurants: admins and managers get it, as new ones do from the role templates.
INSERT INTO role_permissions (role_id, permission_id, granted_at)
  SELECT r.id, 'perm-043', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM roles r
   WHERE r.code IN ('ADMIN', 'MANAGER') AND r.deleted_at IS NULL;

-- One guest's rating of one order: the captain, and a word for the restaurant.
CREATE TABLE order_ratings (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    order_id        TEXT NOT NULL UNIQUE REFERENCES orders(id),
    customer_id     TEXT NOT NULL REFERENCES customers(id),
    -- Who looked after the table, as it was when the guest rated.
    captain_id      TEXT REFERENCES users(id),
    captain_stars   INTEGER CHECK (captain_stars BETWEEN 1 AND 5),
    comment         TEXT CHECK (comment IS NULL OR length(comment) <= 500),
    business_date   TEXT NOT NULL,
    created_at      TEXT NOT NULL
) STRICT;
CREATE INDEX ix_order_ratings_branch ON order_ratings(branch_id, business_date);
CREATE INDEX ix_order_ratings_captain ON order_ratings(captain_id) WHERE captain_id IS NOT NULL;

-- Each dish of that order the guest rated. PENDING until an admin decides:
-- COUNTED ratings make up the dish's stars on the guest menu; EXCLUDED don't.
CREATE TABLE dish_ratings (
    id              TEXT PRIMARY KEY,
    order_rating_id TEXT NOT NULL REFERENCES order_ratings(id),
    menu_item_id    TEXT NOT NULL REFERENCES menu_items(id),
    stars           INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment         TEXT CHECK (comment IS NULL OR length(comment) <= 300),
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COUNTED','EXCLUDED')),
    reviewed_at     TEXT,
    reviewed_by     TEXT REFERENCES users(id),
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (order_rating_id, menu_item_id)
) STRICT;
CREATE INDEX ix_dish_ratings_item ON dish_ratings(menu_item_id, status);

CREATE TRIGGER trg_order_ratings_no_delete BEFORE DELETE ON order_ratings
BEGIN SELECT RAISE(ABORT, 'order_ratings cannot be deleted; an admin leaves a rating out instead'); END;
CREATE TRIGGER trg_dish_ratings_no_delete BEFORE DELETE ON dish_ratings
BEGIN SELECT RAISE(ABORT, 'dish_ratings cannot be deleted; an admin leaves a rating out instead'); END;

-- The bestseller list an admin keeps, in order. Published ones show on the
-- guest menu; the rest wait. A configuration list, deletable by design (audited).
CREATE TABLE bestsellers (
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    menu_item_id    TEXT NOT NULL REFERENCES menu_items(id),
    position        INTEGER NOT NULL CHECK (position >= 0),
    published       INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
    updated_at      TEXT NOT NULL,
    updated_by      TEXT REFERENCES users(id),
    PRIMARY KEY (branch_id, menu_item_id)
) STRICT;
