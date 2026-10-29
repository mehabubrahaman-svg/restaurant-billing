-- Phase 5 (Reporting): scheduled reports. Each schedule makes a file for the
-- last whole day, week (Monday to Sunday) or month of its branch as soon as
-- that period has ended. Files are kept under the Hub's data folder
-- (reports/), listed in report_files, and pruned after 400 days.

CREATE TABLE report_schedules (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    report          TEXT NOT NULL
                    CHECK (report IN ('SALES','SALES_REGISTER','DAY_END','GSTR1','GSTR3B','VAT_REGISTER')),
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

CREATE TABLE report_files (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    schedule_id     TEXT REFERENCES report_schedules(id),
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

CREATE INDEX ix_report_files_branch ON report_files(branch_id, created_at);

CREATE TRIGGER trg_report_schedules_no_delete BEFORE DELETE ON report_schedules
BEGIN SELECT RAISE(ABORT, 'report_schedules cannot be deleted; set is_active = 0'); END;
CREATE TRIGGER trg_report_files_no_delete BEFORE DELETE ON report_files
BEGIN SELECT RAISE(ABORT, 'report_files cannot be deleted; they are marked PRUNED'); END;
