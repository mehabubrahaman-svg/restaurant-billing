import type { BusinessCalendar } from '@restroos/application';
import { BusinessDate } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';

/** Business date from the branch's time zone and its "day starts at" setting (default 04:00). */
export class SqliteBusinessCalendar implements BusinessCalendar {
  constructor(private readonly db: SqliteDatabase) {}

  businessDate(branchId: string, at: Date): string {
    const row = this.db
      .prepare<[string], { timezone: string; day_start: string | null }>(
        `SELECT b.timezone,
                (SELECT json_extract(s.value_json, '$') FROM settings s
                  WHERE s.key = 'business.day_starts_at' AND (s.branch_id = b.id OR s.branch_id IS NULL)
                  ORDER BY s.branch_id IS NULL LIMIT 1) AS day_start
           FROM branches b WHERE b.id = ?`,
      )
      .get(branchId);
    return BusinessDate.at(at, row?.timezone ?? 'Asia/Kolkata', row?.day_start ?? '04:00').value;
  }
}
