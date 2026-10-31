-- Print jobs for printers attached to a tablet (Bluetooth classic or LE).
-- The Hub renders the ESC/POS bytes as for any printer and queues them here;
-- the tablet's app (apps/android) fetches its jobs, prints over Bluetooth and
-- reports back. Jobs nobody picked up within 10 minutes expire, so a tablet
-- coming back online doesn't print an hour of stale tickets.
CREATE TABLE device_print_jobs (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    device_id       TEXT NOT NULL REFERENCES devices(id),
    printer_id      TEXT NOT NULL REFERENCES printers(id),
    payload         BLOB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'QUEUED'
                    CHECK (status IN ('QUEUED','PRINTED','FAILED','EXPIRED')),
    error           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
) STRICT;

CREATE INDEX ix_device_print_jobs_queue ON device_print_jobs(device_id, status, created_at);

CREATE TRIGGER trg_device_print_jobs_no_delete BEFORE DELETE ON device_print_jobs
BEGIN SELECT RAISE(ABORT, 'device_print_jobs cannot be deleted; use a status change'); END;
