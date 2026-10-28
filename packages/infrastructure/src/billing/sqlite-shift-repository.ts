import type { ShiftRecord, ShiftRepository, TenderCount } from '@restroos/application';
import type { PaymentMethod } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

interface ShiftRow {
  id: string;
  branch_id: string;
  device_id: string | null;
  opened_by: string;
  opened_at: string;
  opening_float: number;
  status: 'OPEN' | 'CLOSED';
  version: number;
}

const toShift = (r: ShiftRow): ShiftRecord => ({
  id: r.id,
  branchId: r.branch_id,
  deviceId: r.device_id,
  openedBy: r.opened_by,
  openedAt: new Date(r.opened_at),
  openingFloat: r.opening_float,
  status: r.status,
  version: r.version,
});

export class SqliteShiftRepository implements ShiftRepository {
  constructor(private readonly db: SqliteDatabase) {}

  openFor(branchId: string, deviceId: string | null, userId: string): ShiftRecord | undefined {
    const row = deviceId
      ? this.db
          .prepare<[string, string], ShiftRow>(
            "SELECT * FROM cash_shifts WHERE branch_id = ? AND device_id = ? AND status = 'OPEN'",
          )
          .get(branchId, deviceId)
      : this.db
          .prepare<[string, string], ShiftRow>(
            "SELECT * FROM cash_shifts WHERE branch_id = ? AND device_id IS NULL AND opened_by = ? AND status = 'OPEN'",
          )
          .get(branchId, userId);
    return row && toShift(row);
  }

  get(branchId: string, id: string): ShiftRecord | undefined {
    const row = this.db
      .prepare<[string, string], ShiftRow>(
        'SELECT * FROM cash_shifts WHERE id = ? AND branch_id = ?',
      )
      .get(id, branchId);
    return row && toShift(row);
  }

  insert(r: ShiftRecord): void {
    this.db
      .prepare(
        `INSERT INTO cash_shifts (id, branch_id, device_id, opened_by, opened_at, opening_float, status, version)
         VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.deviceId,
        r.openedBy,
        r.openedAt.toISOString(),
        r.openingFloat,
        r.version,
      );
  }

  close(
    id: string,
    expectedVersion: number,
    input: {
      closedBy: string;
      closedAt: Date;
      expectedCash: number;
      countedCash: number;
      denominations: Record<string, number> | null;
      notes: string | null;
      tenders: readonly TenderCount[];
    },
  ): void {
    const result = this.db
      .prepare(
        `UPDATE cash_shifts SET status = 'CLOSED', closed_by = ?, closed_at = ?, expected_cash = ?, counted_cash = ?,
                variance = ?, denominations_json = ?, notes = ?, version = version + 1
          WHERE id = ? AND version = ? AND status = 'OPEN'`,
      )
      .run(
        input.closedBy,
        input.closedAt.toISOString(),
        input.expectedCash,
        input.countedCash,
        input.countedCash - input.expectedCash,
        input.denominations && JSON.stringify(input.denominations),
        input.notes,
        id,
        expectedVersion,
      );
    assertVersionMatched(result, 'CashShift', id);
    const tender = this.db.prepare(
      `INSERT INTO shift_tender_counts (cash_shift_id, method, terminal_label, expected_amount, reported_amount, variance)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const t of input.tenders)
      tender.run(id, t.method, t.terminalLabel, t.expected, t.reported, t.reported - t.expected);
  }

  tenderTotals(shiftId: string) {
    return this.db
      .prepare<[string], { method: PaymentMethod; terminalLabel: string; amount: number }>(
        `SELECT method, coalesce(terminal_label, '') AS terminalLabel, sum(amount) AS amount
           FROM payments WHERE shift_id = ? GROUP BY method, coalesce(terminal_label, '') ORDER BY method, terminalLabel`,
      )
      .all(shiftId);
  }
}
