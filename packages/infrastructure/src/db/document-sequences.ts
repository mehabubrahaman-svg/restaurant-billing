import type { SqliteDatabase } from './connection';

/**
 * The next gapless number of a branch's series in a financial year, e.g.
 * "KOL1/2026-27/000123". The counter moves inside the caller's transaction
 * (BEGIN IMMEDIATE), so a rolled-back document never uses a number.
 */
export function nextDocumentNumber(
  db: SqliteDatabase,
  branchId: string,
  series: string,
  fiscalYear: string,
  prefix: string,
): string {
  db.prepare(
    `INSERT INTO document_sequences (branch_id, series, fiscal_year, next_value, prefix) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (branch_id, series, fiscal_year) DO NOTHING`,
  ).run(branchId, series, fiscalYear, prefix);
  const row = db
    .prepare<[string, string, string], { next_value: number; prefix: string }>(
      `UPDATE document_sequences SET next_value = next_value + 1
        WHERE branch_id = ? AND series = ? AND fiscal_year = ?
        RETURNING next_value - 1 AS next_value, prefix`,
    )
    .get(branchId, series, fiscalYear)!;
  return `${row.prefix}${String(row.next_value).padStart(6, '0')}`;
}
