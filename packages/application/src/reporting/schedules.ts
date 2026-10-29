import { DomainError } from '@restroos/domain';
import type { BusinessCalendar } from '../ordering/ports';
import type { Patch } from '../patch';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type { SettingsRepository } from '../settings/ports';
import { recordChanged } from '../shared-events';
import { dayEndCsv, salesRegisterCsv } from './csv';
import { gstr1Workbook, gstr3bWorkbook, vatRegisterWorkbook, type GstReturnQueries } from './gst';
import { addDays, lastCompletePeriod, type Period, type PeriodGrouping } from './periods';
import type { ReportQueries } from './ports';
import { salesRegisterWorkbook, salesReportWorkbook } from './sales-workbook';
import { workbookToCsv, type Workbook } from './workbook';

export type ScheduledReport =
  'SALES' | 'SALES_REGISTER' | 'DAY_END' | 'GSTR1' | 'GSTR3B' | 'VAT_REGISTER';
export type ScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type ReportFileFormat = 'XLSX' | 'CSV';

/** GST returns and the VAT register need reports.financial. */
export const FINANCIAL_REPORTS: ReadonlySet<ScheduledReport> = new Set([
  'GSTR1',
  'GSTR3B',
  'VAT_REGISTER',
]);

export interface ReportScheduleRecord {
  id: string;
  branchId: string;
  report: ScheduledReport;
  frequency: ScheduleFrequency;
  format: ReportFileFormat;
  isActive: boolean;
  /** The last period a file was made for (its last day). */
  lastPeriodTo: string | null;
  lastRunAt: string | null;
  /** Why the last run failed, until one succeeds. */
  lastError: string | null;
  version: number;
}

export interface ReportFileRecord {
  id: string;
  branchId: string;
  scheduleId: string | null;
  report: ScheduledReport;
  periodFrom: string;
  periodTo: string;
  format: ReportFileFormat;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  status: 'AVAILABLE' | 'PRUNED';
  createdAt: string;
  /** Null when the schedule made it; who pressed "Make now" otherwise. */
  createdBy: string | null;
}

export interface ReportScheduleRepository {
  /** Every branch's schedules, or one branch's. */
  all(branchId?: string): ReportScheduleRecord[];
  get(id: string): ReportScheduleRecord | undefined;
  insert(record: ReportScheduleRecord, actorId: string | null, at: Date): void;
  /** Version-checked. */
  update(record: ReportScheduleRecord, actorId: string | null, at: Date): void;
  /** A run's outcome, without a version bump. */
  recordRun(
    id: string,
    run: { lastPeriodTo: string | null; lastRunAt: string; lastError: string | null },
  ): void;
}

export interface ReportFileRepository {
  /** Newest first. */
  list(branchId: string, limit: number): ReportFileRecord[];
  get(id: string): ReportFileRecord | undefined;
  insert(record: ReportFileRecord): void;
  /** Available files made before `before` (ISO), to prune. */
  madeBefore(before: string): ReportFileRecord[];
  markPruned(id: string, at: Date): void;
}

/** Where report files are kept on the Hub (and copied, if a folder is set). */
export interface ReportFileStore {
  /** Kept under the file's id, so a file made again never replaces an older one. */
  write(
    id: string,
    fileName: string,
    content: string | Uint8Array,
  ): { path: string; sizeBytes: number };
  read(path: string): Uint8Array | undefined;
  remove(path: string): void;
}

const GROUPING: Record<ScheduleFrequency, PeriodGrouping> = {
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
};
const SLUG: Record<ScheduledReport, string> = {
  SALES: 'sales',
  SALES_REGISTER: 'sales-register',
  DAY_END: 'day-end',
  GSTR1: 'gstr1',
  GSTR3B: 'gstr3b',
  VAT_REGISTER: 'vat-register',
};
/** Files are kept this long, then removed. */
export const REPORT_FILE_RETENTION_DAYS = 400;

type ScheduleInput = Pick<ReportScheduleRecord, 'report' | 'frequency' | 'format'>;

/** The day-end report is one business day, and only a CSV. */
function checkShape(s: ScheduleInput): void {
  if (s.report === 'DAY_END' && (s.frequency !== 'DAILY' || s.format !== 'CSV')) {
    throw new DomainError('VALIDATION_FAILED', 'the day-end report is made daily, as a CSV');
  }
}

/**
 * Reports made by themselves (docs/08 Phase 5): each schedule makes a file
 * for the last whole day, week (Monday to Sunday) or month as soon as it has
 * ended, kept on the Hub to download from Reports → Scheduled.
 */
export class ReportScheduleService {
  constructor(
    private readonly d: {
      schedules: ReportScheduleRepository;
      files: ReportFileRepository;
      store: ReportFileStore;
      reports: ReportQueries;
      gst: GstReturnQueries;
      settings: SettingsRepository;
      calendar: BusinessCalendar;
      /** Workbook → .xlsx bytes. */
      xlsx: (workbook: Workbook) => Uint8Array;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  list(branchId: string): ReportScheduleRecord[] {
    return this.d.schedules.all(branchId);
  }

  files(branchId: string): ReportFileRecord[] {
    return this.d.files.list(branchId, 200);
  }

  create(input: ScheduleInput, ctx: CommandContext): ReportScheduleRecord {
    checkShape(input);
    return this.d.unitOfWork.run(ctx, (scope) => {
      const record: ReportScheduleRecord = {
        ...input,
        id: this.d.ids.next(),
        branchId: ctx.branchId,
        isActive: true,
        lastPeriodTo: null,
        lastRunAt: null,
        lastError: null,
        version: 1,
      };
      const now = this.d.clock.now();
      this.d.schedules.insert(record, ctx.actorId, now);
      scope.recordEvents([
        recordChanged('ReportScheduleCreated', 'ReportSchedule', record.id, 1, record, now),
      ]);
      scope.audit({
        action: 'reports.schedule.create',
        entityType: 'ReportSchedule',
        entityId: record.id,
        after: record,
      });
      return record;
    });
  }

  update(
    id: string,
    patch: Patch<Omit<ScheduleInput, 'report'> & { isActive: boolean }> & { version: number },
    ctx: CommandContext,
  ): ReportScheduleRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.schedule(id, ctx.branchId);
      if (current.version !== patch.version)
        throw new DomainError('VERSION_CONFLICT', 'this schedule changed; reload');
      const next: ReportScheduleRecord = { ...current, version: current.version + 1 };
      for (const [k, v] of Object.entries(patch))
        if (v !== undefined && k !== 'version') (next as unknown as Record<string, unknown>)[k] = v;
      checkShape(next);
      // A new frequency starts again from the last whole period.
      if (next.frequency !== current.frequency) next.lastPeriodTo = null;
      const now = this.d.clock.now();
      this.d.schedules.update(next, ctx.actorId, now);
      scope.recordEvents([
        recordChanged('ReportScheduleChanged', 'ReportSchedule', id, next.version, next, now),
      ]);
      scope.audit({
        action: 'reports.schedule.update',
        entityType: 'ReportSchedule',
        entityId: id,
        before: current,
        after: next,
      });
      return next;
    });
  }

  /** "Make now": the file for the last whole period, again if it was made already. */
  runNow(id: string, ctx: CommandContext): ReportFileRecord {
    const schedule = this.schedule(id, ctx.branchId);
    return this.make(schedule, this.lastPeriod(schedule), ctx.actorId);
  }

  /**
   * The job (every few minutes): each active schedule whose last whole period
   * has no file yet gets one. A Hub that was off catches up with the latest
   * period only. Files past the retention are removed. Returns what was made.
   */
  runDue(): { made: ReportFileRecord[]; failed: { scheduleId: string; error: string }[] } {
    const made: ReportFileRecord[] = [];
    const failed: { scheduleId: string; error: string }[] = [];
    for (const schedule of this.d.schedules.all()) {
      if (!schedule.isActive) continue;
      const period = this.lastPeriod(schedule);
      if (schedule.lastPeriodTo !== null && schedule.lastPeriodTo >= period.to) continue;
      try {
        made.push(this.make(schedule, period, null));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.d.schedules.recordRun(schedule.id, {
          lastPeriodTo: schedule.lastPeriodTo,
          lastRunAt: this.d.clock.now().toISOString(),
          lastError: message.slice(0, 500),
        });
        failed.push({ scheduleId: schedule.id, error: message });
      }
    }
    this.prune();
    return { made, failed };
  }

  /** The file's bytes, to download. */
  download(id: string, branchId: string): { file: ReportFileRecord; content: Uint8Array } {
    const file = this.d.files.get(id);
    if (!file || file.branchId !== branchId) throw new DomainError('NOT_FOUND', 'file not found');
    const content = file.status === 'AVAILABLE' ? this.d.store.read(file.filePath) : undefined;
    if (!content) throw new DomainError('NOT_FOUND', 'this file is no longer kept on the Hub');
    return { file, content };
  }

  /** One of the branch's schedules. */
  get(id: string, branchId: string): ReportScheduleRecord {
    return this.schedule(id, branchId);
  }

  private schedule(id: string, branchId: string): ReportScheduleRecord {
    const schedule = this.d.schedules.get(id);
    if (!schedule || schedule.branchId !== branchId)
      throw new DomainError('NOT_FOUND', 'schedule not found');
    return schedule;
  }

  private lastPeriod(schedule: ReportScheduleRecord): Period {
    const today = this.d.calendar.businessDate(schedule.branchId, this.d.clock.now());
    return lastCompletePeriod(today, GROUPING[schedule.frequency]);
  }

  private make(
    schedule: ReportScheduleRecord,
    period: Period,
    actorId: string | null,
  ): ReportFileRecord {
    const now = this.d.clock.now();
    const content = this.content(schedule, period, now);
    const range = period.from === period.to ? period.from : `${period.from}-to-${period.to}`;
    const fileName = `${SLUG[schedule.report]}-${range}.${schedule.format.toLowerCase()}`;
    const id = this.d.ids.next();
    const written = this.d.store.write(id, fileName, content);
    const file: ReportFileRecord = {
      id,
      branchId: schedule.branchId,
      scheduleId: schedule.id,
      report: schedule.report,
      periodFrom: period.from,
      periodTo: period.to,
      format: schedule.format,
      fileName,
      filePath: written.path,
      sizeBytes: written.sizeBytes,
      status: 'AVAILABLE',
      createdAt: now.toISOString(),
      createdBy: actorId,
    };
    this.d.files.insert(file);
    this.d.schedules.recordRun(schedule.id, {
      lastPeriodTo:
        schedule.lastPeriodTo !== null && schedule.lastPeriodTo > period.to
          ? schedule.lastPeriodTo
          : period.to,
      lastRunAt: now.toISOString(),
      lastError: null,
    });
    return file;
  }

  private content(
    schedule: ReportScheduleRecord,
    { from, to }: Period,
    now: Date,
  ): string | Uint8Array {
    const branchId = schedule.branchId;
    // The two CSVs the Hub already makes, the same as their downloads.
    if (schedule.report === 'DAY_END') return dayEndCsv(this.d.reports.dayEnd(branchId, from, now));
    if (schedule.report === 'SALES_REGISTER' && schedule.format === 'CSV')
      return salesRegisterCsv(this.d.reports.salesRegister(branchId, from, to));
    const workbook = this.workbook(schedule.report, branchId, from, to, now);
    return schedule.format === 'XLSX' ? this.d.xlsx(workbook) : workbookToCsv(workbook);
  }

  private workbook(
    report: ScheduledReport,
    branchId: string,
    from: string,
    to: string,
    now: Date,
  ): Workbook {
    switch (report) {
      case 'SALES':
        return salesReportWorkbook(this.d.reports.sales(branchId, from, to, 'day', now));
      case 'SALES_REGISTER':
        return salesRegisterWorkbook(this.d.reports.salesRegister(branchId, from, to), {
          branchName: this.d.settings.branch(branchId)?.name ?? '',
          from,
          to,
        });
      case 'GSTR1':
        return gstr1Workbook(this.d.gst.gstr1(branchId, from, to, now));
      case 'GSTR3B':
        return gstr3bWorkbook(this.d.gst.gstr3b(branchId, from, to, now));
      case 'VAT_REGISTER':
        return vatRegisterWorkbook(this.d.gst.vatRegister(branchId, from, to, now));
      case 'DAY_END':
        throw new DomainError('VALIDATION_FAILED', 'the day-end report is a CSV');
    }
  }

  private prune(): void {
    const before = addDays(
      this.d.clock.now().toISOString().slice(0, 10),
      -REPORT_FILE_RETENTION_DAYS,
    );
    for (const file of this.d.files.madeBefore(before)) {
      this.d.store.remove(file.filePath);
      this.d.files.markPruned(file.id, this.d.clock.now());
    }
  }
}
