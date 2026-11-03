-- Photos of dishes (docs/03 §5). The browser shrinks and re-encodes each
-- photo before upload (which also drops EXIF and GPS data), and the Hub keeps
-- the bytes here, inside the encrypted database, so backups and restores
-- carry them with no extra files. An asset's id is the SHA-256 of its full
-- image: the same photo uploaded twice is stored once.
CREATE TABLE media_assets (
    id              TEXT PRIMARY KEY CHECK (length(id) = 64),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    mime            TEXT NOT NULL CHECK (mime IN ('image/webp','image/jpeg','image/png')),
    width           INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
    height          INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
    bytes           BLOB NOT NULL,
    -- A small square crop for POS tiles and lists.
    thumb_mime      TEXT NOT NULL CHECK (thumb_mime IN ('image/webp','image/jpeg','image/png')),
    thumb           BLOB NOT NULL,
    created_at      TEXT NOT NULL,
    created_by      TEXT REFERENCES users(id)
) STRICT;

-- 0001's image_path (a file path) was never used; items point at an asset instead.
ALTER TABLE menu_items ADD COLUMN image_id TEXT REFERENCES media_assets(id);
