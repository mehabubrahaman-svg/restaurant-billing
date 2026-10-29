import type { SalesChannelRecord, SalesChannelRepository } from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

type Row = Omit<SalesChannelRecord, 'gstPaidByOperator' | 'isActive'> & {
  gstPaidByOperator: number;
  isActive: number;
};
const COLUMNS = `id, code, name, kind, integration, commission_bp AS commissionBp, price_markup_bp AS priceMarkupBp,
                 gst_paid_by_operator AS gstPaidByOperator, operator_gstin AS operatorGstin,
                 is_active AS isActive, version`;
const toRecord = (r: Row): SalesChannelRecord => ({
  ...r,
  gstPaidByOperator: r.gstPaidByOperator === 1,
  isActive: r.isActive === 1,
});

export class SqliteSalesChannelRepository implements SalesChannelRepository {
  constructor(private readonly db: SqliteDatabase) {}

  all(): SalesChannelRecord[] {
    return this.db
      .prepare<[], Row>(
        `SELECT ${COLUMNS} FROM sales_channels WHERE deleted_at IS NULL ORDER BY code = 'DIRECT' DESC, name`,
      )
      .all()
      .map(toRecord);
  }

  get(id: string): SalesChannelRecord | undefined {
    const r = this.db
      .prepare<[string], Row>(`SELECT ${COLUMNS} FROM sales_channels WHERE id = ?`)
      .get(id);
    return r && toRecord(r);
  }

  byCode(code: string): SalesChannelRecord | undefined {
    const r = this.db
      .prepare<[string], Row>(`SELECT ${COLUMNS} FROM sales_channels WHERE code = ?`)
      .get(code);
    return r && toRecord(r);
  }

  insert(r: SalesChannelRecord, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO sales_channels (id, organization_id, code, name, kind, integration, commission_bp, price_markup_bp,
                                     gst_paid_by_operator, operator_gstin, is_active, created_at, updated_at, version)
         VALUES (?, (SELECT id FROM organizations LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.code,
        r.name,
        r.kind,
        r.integration,
        r.commissionBp,
        r.priceMarkupBp,
        r.gstPaidByOperator ? 1 : 0,
        r.operatorGstin,
        at.toISOString(),
        at.toISOString(),
        r.version,
      );
  }

  update(r: SalesChannelRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE sales_channels SET code = ?, name = ?, kind = ?, commission_bp = ?, price_markup_bp = ?,
                gst_paid_by_operator = ?, operator_gstin = ?, is_active = ?, updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.code,
        r.name,
        r.kind,
        r.commissionBp,
        r.priceMarkupBp,
        r.gstPaidByOperator ? 1 : 0,
        r.operatorGstin,
        r.isActive ? 1 : 0,
        at.toISOString(),
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'SalesChannel', r.id);
  }

  existingOrderId(channelId: string, externalOrderId: string): string | undefined {
    return this.db
      .prepare<[string, string], string>(
        'SELECT id FROM orders WHERE sales_channel_id = ? AND external_order_id = ? LIMIT 1',
      )
      .pluck()
      .get(channelId, externalOrderId);
  }
}
