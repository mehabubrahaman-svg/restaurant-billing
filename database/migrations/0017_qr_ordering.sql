-- Phase 5 (Ordering): QR self-ordering. A guest's order (or call for the
-- waiter or the bill) from the table's QR code waits here until a captain
-- accepts it onto the table's order or declines it. Items keep the names
-- the guest saw; prices are taken from the menu when the order is accepted.

CREATE TABLE qr_requests (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    table_id        TEXT NOT NULL REFERENCES dining_tables(id),
    kind            TEXT NOT NULL CHECK (kind IN ('ORDER','WAITER','BILL')),
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','DONE')),
    items_json      TEXT NOT NULL DEFAULT '[]',
    guest_name      TEXT,
    covers          INTEGER CHECK (covers IS NULL OR covers BETWEEN 1 AND 50),
    note            TEXT,
    order_id        TEXT REFERENCES orders(id),
    handled_by      TEXT REFERENCES users(id),
    handled_at      TEXT,
    reject_reason   TEXT,
    client_key      TEXT,                       -- the phone's key: a retried send is not a second order
    created_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX ix_qr_requests_pending ON qr_requests(branch_id, status, created_at);
CREATE UNIQUE INDEX ux_qr_requests_client ON qr_requests(table_id, client_key) WHERE client_key IS NOT NULL;

CREATE TRIGGER trg_qr_requests_no_delete BEFORE DELETE ON qr_requests
BEGIN SELECT RAISE(ABORT, 'qr_requests cannot be deleted; they are answered'); END;
