-- Sprint 5 (WP 5.8): encrypted backups with retention and restore.
-- The backups table gains the kinds restore needs, a status for pruned or
-- missing files, and the schema version each backup was taken at. Rows are
-- never deleted; pruning marks them PRUNED.

CREATE TABLE backups_new (
    id              TEXT PRIMARY KEY,
    file_path       TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    sha256          TEXT NOT NULL,
    is_encrypted    INTEGER NOT NULL DEFAULT 1 CHECK (is_encrypted IN (0,1)),
    kind            TEXT NOT NULL
                    CHECK (kind IN ('SCHEDULED','MANUAL','PRE_MIGRATION','PRE_RESTORE','IMPORTED')),
    status          TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','PRUNED','MISSING')),
    schema_version  INTEGER,
    -- Where else the file was copied (USB drive / NAS), if anywhere.
    copied_to       TEXT,
    pruned_at       TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT
) STRICT;

INSERT INTO backups_new (id, file_path, size_bytes, sha256, is_encrypted, kind, created_at, created_by)
SELECT id, file_path, size_bytes, sha256, is_encrypted, kind, created_at, created_by FROM backups;

DROP TABLE backups;
ALTER TABLE backups_new RENAME TO backups;

CREATE INDEX idx_backups_created ON backups(created_at);
CREATE UNIQUE INDEX uq_backups_file ON backups(file_path);

CREATE TRIGGER trg_backups_no_delete BEFORE DELETE ON backups
BEGIN SELECT RAISE(ABORT, 'backups cannot be deleted; use soft delete or a status change'); END;
