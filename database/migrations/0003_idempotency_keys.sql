-- =============================================================================
-- Idempotency keys for POST commands (offline replay, double taps).
-- This is a cache, not business data: rows expire and are purged.
-- =============================================================================

CREATE TABLE idempotency_keys (
    scope           TEXT NOT NULL,              -- user id or device id that sent the request
    key             TEXT NOT NULL,              -- client-supplied Idempotency-Key
    request_hash    TEXT NOT NULL,              -- SHA-256 of method + path + body; reuse with another body is rejected
    status_code     INTEGER NOT NULL,
    response_body   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    PRIMARY KEY (scope, key)
) STRICT;
CREATE INDEX ix_idempotency_expiry ON idempotency_keys(expires_at);
