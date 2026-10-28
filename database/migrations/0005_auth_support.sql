-- =============================================================================
-- Authentication support.
-- =============================================================================

-- Secrets the Hub generates for itself (JWT signing key, backup encryption key).
-- Lives inside the encrypted database and is never exposed by any API.
CREATE TABLE system_secrets (
    name            TEXT PRIMARY KEY,           -- 'jwt.ed25519.pkcs8', 'backup.key'
    value           TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    rotated_at      TEXT
) STRICT;

CREATE TRIGGER trg_system_secrets_no_delete BEFORE DELETE ON system_secrets
BEGIN SELECT RAISE(ABORT, 'system_secrets cannot be deleted; rotate instead'); END;

-- A session belongs to one branch: refreshing keeps the user in that branch.
ALTER TABLE refresh_tokens ADD COLUMN branch_id TEXT REFERENCES branches(id);

CREATE INDEX ix_refresh_tokens_family ON refresh_tokens(family_id, revoked_at);
