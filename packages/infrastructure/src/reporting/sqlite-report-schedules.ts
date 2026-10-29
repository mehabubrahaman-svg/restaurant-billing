import type {
  ReportFileRecord,
  ReportFileRepository,
  ReportScheduleRecord,
  ReportScheduleRepository,
} from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

type ScheduleRow = Omit<ReportScheduleRecord, 'isActive'> & { isActive: number };
const SCHEDULE_COLUMNS = `id, branch_id AS branchId, report, frequency, format, is_active AS isActive,
                          last_period_to AS lastPeriodTo, last_run_at AS lastRunAt, last_error AS lastError, version`;
const toSchedule = (r: ScheduleRow): ReportScheduleRecord => ({ ...r, isActive: r.isActive === 1 });

export class SqliteReportScheduleRepository implements ReportScheduleRepository {
  constructor(private readonly db: SqliteDatabase) {}

  all(branchId?: string): ReportScheduleRecord[] {
    const order = 'ORDER BY created_at, id';
    return (
      branchId === undefined
        ? this.db
            .prepare<[], ScheduleRow>(`SELECT ${SCHEDULE_COLUMNS} FROM report_schedules ${order}`)
            .all()
        : this.db
            .prepare<[string], ScheduleRow>(
              `SELECT ${SCHEDULE_COLUMNS} FROM report_schedules WHERE branch_id = ? ${order}`,
            )
            .all(branchId)
    ).map(toSchedule);
  }

  get(id: string): ReportScheduleRecord | undefined {
    const r = this.db
      .prepare<[string], ScheduleRow>(
        `SELECT ${SCHEDULE_COLUMNS} FROM report_schedules WHERE id = ?`,
      )
      .get(id);
    return r && toSchedule(r);
  }

  insert(r: ReportScheduleRecord, actorId: string | null, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO report_schedules (id, branch_id, report, frequency, format, is_active, last_period_to,
                                       last_run_at, last_error, created_at, created_by, updated_at, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.report,
        r.frequency,
        r.format,
        r.isActive ? 1 : 0,
        r.lastPeriodTo,
        r.lastRunAt,
        r.lastError,
        at.toISOString(),
        actorId,
        at.toISOString(),
        actorId,
        r.version,
      );
  }

  update(r: ReportScheduleRecord, actorId: string | null, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE report_schedules SET frequency = ?, format = ?, is_active = ?, last_period_to = ?,
                updated_at = ?, updated_by = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.frequency,
        r.format,
        r.isActive ? 1 : 0,
        r.lastPeriodTo,
        at.toISOString(),
        actorId,
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'ReportSchedule', r.id);
  }

  recordRun(
    id: string,
    run: { lastPeriodTo: string | null; lastRunAt: string; lastError: string | null },
  ): void {
    this.db
      .prepare(
        'UPDATE report_schedules SET last_period_to = ?, last_run_at = ?, last_error = ? WHERE id = ?',
      )
      .run(run.lastPeriodTo, run.lastRunAt, run.lastError, id);
  }
}

const FILE_COLUMNS = `id, branch_id AS branchId, schedule_id AS scheduleId, report, period_from AS periodFrom,
                      period_to AS periodTo, format, file_name AS fileName, file_path AS filePath,
                      size_bytes AS sizeBytes, status, created_at AS createdAt, created_by AS createdBy`;

export class SqliteReportFileRepository implements ReportFileRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(branchId: string, limit: number): ReportFileRecord[] {
    return this.db
      .prepare<[string, number], ReportFileRecord>(
        `SELECT ${FILE_COLUMNS} FROM report_files WHERE branch_id = ? AND status = 'AVAILABLE'
          ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(branchId, limit);
  }

  get(id: string): ReportFileRecord | undefined {
    return this.db
      .prepare<[string], ReportFileRecord>(`SELECT ${FILE_COLUMNS} FROM report_files WHERE id = ?`)
      .get(id);
  }

  insert(r: ReportFileRecord): void {
    this.db
      .prepare(
        `INSERT INTO report_files (id, branch_id, schedule_id, report, period_from, period_to, format, file_name,
                                   file_path, size_bytes, status, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.scheduleId,
        r.report,
        r.periodFrom,
        r.periodTo,
        r.format,
        r.fileName,
        r.filePath,
        r.sizeBytes,
        r.status,
        r.createdAt,
        r.createdBy,
      );
  }

  madeBefore(before: string): ReportFileRecord[] {
    return this.db
      .prepare<[string], ReportFileRecord>(
        `SELECT ${FILE_COLUMNS} FROM report_files WHERE status = 'AVAILABLE' AND created_at < ?`,
      )
      .all(before);
  }

  markPruned(id: string, at: Date): void {
    this.db
      .prepare("UPDATE report_files SET status = 'PRUNED', pruned_at = ? WHERE id = ?")
      .run(at.toISOString(), id);
  }
}
