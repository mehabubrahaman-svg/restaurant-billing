-- =============================================================================
-- Sprint 3: menu ordering, add-on translations, device pairing.
-- =============================================================================

ALTER TABLE menu_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE addon_groups ADD COLUMN name_translations TEXT
    CHECK (name_translations IS NULL OR json_valid(name_translations));

-- A paired device holds a long-lived secret; only its SHA-256 is stored.
ALTER TABLE devices ADD COLUMN token_hash TEXT;
ALTER TABLE devices ADD COLUMN paired_at TEXT;
ALTER TABLE devices ADD COLUMN paired_by TEXT REFERENCES users(id);
CREATE UNIQUE INDEX ux_devices_token ON devices(token_hash) WHERE token_hash IS NOT NULL;

-- One-time codes an admin creates to pair a tablet or screen (shown as a QR).
CREATE TABLE pairing_codes (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    code_hash       TEXT NOT NULL UNIQUE,
    device_name     TEXT NOT NULL,
    device_kind     TEXT NOT NULL CHECK (device_kind IN ('POS','CAPTAIN','KDS','OWNER','TOKEN_DISPLAY','KIOSK')),
    expires_at      TEXT NOT NULL,
    used_at         TEXT,
    used_by_device_id TEXT REFERENCES devices(id),
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id)
) STRICT;

CREATE TRIGGER trg_pairing_codes_no_delete BEFORE DELETE ON pairing_codes
BEGIN SELECT RAISE(ABORT, 'pairing_codes cannot be deleted; they expire'); END;
