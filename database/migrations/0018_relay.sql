-- Phase 5 (Aggregators): the cloud relay (ADR 0007). The Hub keeps an
-- outbound WebSocket to the relay; orders from the aggregator middleware
-- arrive through it, and the menu, availability and order status go back.

-- One link per branch. The key is a secret: the API never returns it.
CREATE TABLE relay_links (
    branch_id       TEXT PRIMARY KEY REFERENCES branches(id),
    relay_url       TEXT NOT NULL,              -- wss://relay.example.com
    hub_id          TEXT NOT NULL,
    hub_key         TEXT NOT NULL,
    is_enabled      INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),
    -- Orders from the relay are entered as this user ("Online orders", no sign-in).
    actor_user_id   TEXT NOT NULL REFERENCES users(id),
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;

-- Every message both ways. IN: a webhook the relay delivered (id = the
-- relay's id, so a redelivery is handled once). OUT: waits as PENDING until
-- the relay has stored it; an older menu push still waiting is SKIPPED.
CREATE TABLE relay_messages (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    direction       TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
    kind            TEXT NOT NULL,              -- order.created, order.cancelled | menu, availability, order-status
    status          TEXT NOT NULL CHECK (status IN ('PENDING','SENT','DONE','FAILED','SKIPPED')),
    channel_code    TEXT,
    external_order_id TEXT,
    order_id        TEXT REFERENCES orders(id),
    payload_json    TEXT NOT NULL,
    error           TEXT,
    created_at      TEXT NOT NULL,
    handled_at      TEXT
) STRICT;

CREATE INDEX ix_relay_messages_branch ON relay_messages(branch_id, created_at);
CREATE INDEX ix_relay_messages_out ON relay_messages(branch_id, direction, status, created_at);

CREATE TRIGGER trg_relay_messages_no_delete BEFORE DELETE ON relay_messages
BEGIN SELECT RAISE(ABORT, 'relay_messages cannot be deleted'); END;
