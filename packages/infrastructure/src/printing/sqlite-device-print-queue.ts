import type { DevicePrintJobRecord, DevicePrintQueue } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

interface Row {
  id: string;
  branch_id: string;
  device_id: string;
  printer_id: string;
  payload: Buffer;
  status: DevicePrintJobRecord['status'];
  error: string | null;
  created_at: string;
}

const toRecord = (r: Row): DevicePrintJobRecord => ({
  id: r.id,
  branchId: r.branch_id,
  deviceId: r.device_id,
  printerId: r.printer_id,
  payload: new Uint8Array(r.payload),
  status: r.status,
  error: r.error,
  createdAt: new Date(r.created_at),
});

/** Print jobs for tablet-attached Bluetooth printers (migration 0020). */
export class SqliteDevicePrintQueue implements DevicePrintQueue {
  constructor(private readonly db: SqliteDatabase) {}

  enqueue(job: Omit<DevicePrintJobRecord, 'status' | 'error'>): void {
    const at = job.createdAt.toISOString();
    this.db
      .prepare(
        `INSERT INTO device_print_jobs (id, branch_id, device_id, printer_id, payload, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?)`,
      )
      .run(job.id, job.branchId, job.deviceId, job.printerId, Buffer.from(job.payload), at, at);
  }

  queued(deviceId: string): DevicePrintJobRecord[] {
    return this.db
      .prepare<[string], Row>(
        `SELECT * FROM device_print_jobs WHERE device_id = ? AND status = 'QUEUED'
          ORDER BY created_at, rowid`,
      )
      .all(deviceId)
      .map(toRecord);
  }

  get(id: string): DevicePrintJobRecord | undefined {
    const row = this.db
      .prepare<[string], Row>('SELECT * FROM device_print_jobs WHERE id = ?')
      .get(id);
    return row && toRecord(row);
  }

  finish(
    id: string,
    status: 'PRINTED' | 'FAILED' | 'EXPIRED',
    error: string | null,
    at: Date,
  ): void {
    this.db
      .prepare(
        `UPDATE device_print_jobs SET status = ?, error = ?, updated_at = ?
          WHERE id = ? AND status = 'QUEUED'`,
      )
      .run(status, error, at.toISOString(), id);
  }
}
