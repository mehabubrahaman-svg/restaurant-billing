-- Phase 5 (Reporting): the stock value report (inventory valuation) can be
-- scheduled like the others. SQLite can't change a CHECK, so report_schedules
-- is rebuilt with INVENTORY_VALUATION in it, and report_files with it, since
-- it points at report_schedules: the files are moved onto the new table
-- before the old one goes, so no reference ever dangles.

CREATE TABLE report_schedules_new (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    report          TEXT NOT NULL
                    CHECK (report IN ('SALES','SALES_REGISTER','DAY_END','GSTR1','GSTR3B','VAT_REGISTER',
                                      'INVENTORY_VALUATION')),
    frequency       TEXT NOT NULL CHECK (frequency IN ('DAILY','WEEKLY','MONTHLY')),
    format          TEXT NOT NULL CHECK (format IN ('XLSX','CSV')),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    last_period_to  TEXT,                       -- the last period a file was made for (its last day)
    last_run_at     TEXT,
    last_error      TEXT,                       -- why the last run failed, until one succeeds
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1
) STRICT;
INSERT INTO report_schedules_new (id, branch_id, report, frequency, format, is_active, last_period_to,
                                  last_run_at, last_error, created_at, created_by, updated_at, updated_by, version)
SELECT id, branch_id, report, frequency, format, is_active, last_period_to,
       last_run_at, last_error, created_at, created_by, updated_at, updated_by, version
  FROM report_schedules;

-- Renaming report_schedules_new below turns this reference into report_schedules.
CREATE TABLE report_files_new (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    schedule_id     TEXT REFERENCES report_schedules_new(id),
    report          TEXT NOT NULL,
    period_from     TEXT NOT NULL,
    period_to       TEXT NOT NULL,
    format          TEXT NOT NULL CHECK (format IN ('XLSX','CSV')),
    file_name       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','PRUNED')),
    pruned_at       TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT                        -- null: made by the schedule
) STRICT;
INSERT INTO report_files_new (id, branch_id, schedule_id, report, period_from, period_to, format, file_name,
                              file_path, size_bytes, status, pruned_at, created_at, created_by)
SELECT id, branch_id, schedule_id, report, period_from, period_to, format, file_name,
       file_path, size_bytes, status, pruned_at, created_at, created_by
  FROM report_files;

-- Dropping a table removes its rows without firing the no-delete triggers.
DROP TABLE report_files;
DROP TABLE report_schedules;
ALTER TABLE report_schedules_new RENAME TO report_schedules;
ALTER TABLE report_files_new RENAME TO report_files;

CREATE INDEX ix_report_files_branch ON report_files(branch_id, created_at);

CREATE TRIGGER trg_report_schedules_no_delete BEFORE DELETE ON report_schedules
BEGIN SELECT RAISE(ABORT, 'report_schedules cannot be deleted; set is_active = 0'); END;
CREATE TRIGGER trg_report_files_no_delete BEFORE DELETE ON report_files
BEGIN SELECT RAISE(ABORT, 'report_files cannot be deleted; they are marked PRUNED'); END;
