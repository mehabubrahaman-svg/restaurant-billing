import type {
  BranchSettingsRecord,
  ChargeRuleRecord,
  PrinterRecord,
  SettingsRepository,
  TaxComponentRecord,
  TaxGroupRecord,
} from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

const BRANCH_SETTING_KEYS = {
  liquorEnabled: 'billing.liquor_enabled',
  liquorInvoice: 'billing.liquor_invoice',
  dayStartsAt: 'business.day_starts_at',
  discountLimitBp: 'billing.discount_limit_bp',
  receiptHeader: 'receipt.header',
  receiptFooter: 'receipt.footer',
} as const;

const DEFAULTS = {
  liquorEnabled: false,
  liquorInvoice: 'SAME',
  dayStartsAt: '04:00',
  discountLimitBp: 1000,
  receiptHeader: '',
  receiptFooter: '',
} as const;

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  branch(branchId: string): BranchSettingsRecord | undefined {
    const row = this.db
      .prepare<
        [string],
        {
          id: string;
          code: string;
          name: string;
          address: string | null;
          phone: string | null;
          state_code: string;
          state_name: string;
          tax_id: string | null;
          vat_tin: string | null;
          excise_licence_no: string | null;
          cash_rounding: number;
          default_locale: string;
          receipt_locales: string;
          version: number;
        }
      >(
        `SELECT b.*, s.name AS state_name FROM branches b
           JOIN indian_states s ON s.gst_state_code = b.state_code
          WHERE b.id = ? AND b.deleted_at IS NULL`,
      )
      .get(branchId);
    if (!row) return undefined;
    const settings = this.settingsOf(branchId);
    const get = <K extends keyof typeof BRANCH_SETTING_KEYS>(k: K) =>
      (settings.get(BRANCH_SETTING_KEYS[k]) ?? DEFAULTS[k]) as BranchSettingsRecord[K];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      phone: row.phone,
      stateCode: row.state_code,
      stateName: row.state_name,
      gstin: row.tax_id,
      vatTin: row.vat_tin,
      exciseLicenceNo: row.excise_licence_no,
      liquorEnabled: get('liquorEnabled'),
      liquorInvoice: get('liquorInvoice'),
      cashRounding: row.cash_rounding,
      defaultLocale: row.default_locale,
      receiptLanguages: JSON.parse(row.receipt_locales) as string[],
      receiptHeader: get('receiptHeader'),
      receiptFooter: get('receiptFooter'),
      dayStartsAt: get('dayStartsAt'),
      discountLimitBp: get('discountLimitBp'),
      version: row.version,
    };
  }

  updateBranch(branchId: string, next: BranchSettingsRecord, at: Date): void {
    const t = at.toISOString();
    const result = this.db
      .prepare(
        `UPDATE branches SET name = @name, address = @address, phone = @phone, tax_id = @gstin, vat_tin = @vatTin,
                excise_licence_no = @exciseLicenceNo, cash_rounding = @cashRounding,
                default_locale = @defaultLocale, receipt_locales = @receiptLocales, updated_at = @t,
                version = @version
          WHERE id = @id AND version = @expected`,
      )
      .run({
        ...next,
        id: branchId,
        receiptLocales: JSON.stringify(next.receiptLanguages),
        t,
        expected: next.version - 1,
      });
    assertVersionMatched(result, 'Branch', branchId);
    const upsert = this.db.prepare(
      `INSERT INTO settings (id, branch_id, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (branch_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at,
                                                  version = settings.version + 1`,
    );
    for (const [field, key] of Object.entries(BRANCH_SETTING_KEYS)) {
      if (field === 'liquorEnabled') continue; // decided at setup
      upsert.run(
        `${branchId}:${key}`,
        branchId,
        key,
        JSON.stringify(next[field as keyof BranchSettingsRecord]),
        t,
      );
    }
  }

  taxGroups(): TaxGroupRecord[] {
    return this.db
      .prepare<[], TaxGroupRow>('SELECT * FROM tax_groups ORDER BY tax_type, name')
      .all()
      .map((r) => this.toTaxGroup(r));
  }

  taxGroup(id: string): TaxGroupRecord | undefined {
    const row = this.db
      .prepare<[string], TaxGroupRow>('SELECT * FROM tax_groups WHERE id = ?')
      .get(id);
    return row && this.toTaxGroup(row);
  }

  insertTaxGroup(r: TaxGroupRecord, at: Date): void {
    const t = at.toISOString();
    const organizationId = this.db.prepare('SELECT id FROM organizations LIMIT 1').pluck().get();
    this.db
      .prepare(
        `INSERT INTO tax_groups (id, organization_id, name, tax_type, tax_category, invoice_series, is_inclusive,
                                 created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        organizationId,
        r.name,
        r.taxType,
        r.taxCategory,
        r.invoiceSeries,
        r.isInclusive ? 1 : 0,
        t,
        t,
        r.version,
      );
    this.writeComponents(r.id, r.components);
  }

  updateTaxGroup(r: TaxGroupRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE tax_groups SET name = ?, tax_type = ?, tax_category = ?, invoice_series = ?, is_inclusive = ?,
                deleted_at = ?, updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.name,
        r.taxType,
        r.taxCategory,
        r.invoiceSeries,
        r.isInclusive ? 1 : 0,
        r.isActive ? null : at.toISOString(),
        at.toISOString(),
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'TaxGroup', r.id);
    this.writeComponents(r.id, r.components);
  }

  private writeComponents(groupId: string, components: TaxComponentRecord[]): void {
    // tax_components belong to their group and are replaced as a whole (audited via the group).
    // eslint-disable-next-line no-restricted-syntax
    this.db.prepare('DELETE FROM tax_components WHERE tax_group_id = ?').run(groupId);
    const insert = this.db.prepare(
      'INSERT INTO tax_components (id, tax_group_id, code, rate_bp, applies_to, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    );
    components.forEach((c, i) =>
      insert.run(`${groupId}:${i}`, groupId, c.code, c.rateBp, c.appliesTo, i),
    );
  }

  chargeRules(branchId: string): ChargeRuleRecord[] {
    return this.db
      .prepare<[string], ChargeRow>('SELECT * FROM charge_rules WHERE branch_id = ? ORDER BY name')
      .all(branchId)
      .map(toChargeRule);
  }

  chargeRule(branchId: string, id: string): ChargeRuleRecord | undefined {
    const row = this.db
      .prepare<[string, string], ChargeRow>(
        'SELECT * FROM charge_rules WHERE branch_id = ? AND id = ?',
      )
      .get(branchId, id);
    return row && toChargeRule(row);
  }

  insertChargeRule(branchId: string, r: ChargeRuleRecord, at: Date): void {
    const t = at.toISOString();
    this.db
      .prepare(
        `INSERT INTO charge_rules (id, branch_id, name, kind, value, order_types, tax_group_id, is_optional, is_active,
                                   created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        r.id,
        branchId,
        r.name,
        r.kind,
        r.value,
        JSON.stringify(r.orderTypes),
        r.taxGroupId,
        r.isOptional ? 1 : 0,
        t,
        t,
        r.version,
      );
  }

  updateChargeRule(branchId: string, r: ChargeRuleRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE charge_rules SET name = ?, kind = ?, value = ?, order_types = ?, tax_group_id = ?, is_optional = ?,
                is_active = ?, updated_at = ?, version = ?
          WHERE branch_id = ? AND id = ? AND version = ?`,
      )
      .run(
        r.name,
        r.kind,
        r.value,
        JSON.stringify(r.orderTypes),
        r.taxGroupId,
        r.isOptional ? 1 : 0,
        r.isActive ? 1 : 0,
        at.toISOString(),
        r.version,
        branchId,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'ChargeRule', r.id);
  }

  printers(branchId: string): PrinterRecord[] {
    return this.db
      .prepare<[string], PrinterRow>('SELECT * FROM printers WHERE branch_id = ? ORDER BY name')
      .all(branchId)
      .map(toPrinter);
  }

  printer(branchId: string, id: string): PrinterRecord | undefined {
    const row = this.db
      .prepare<[string, string], PrinterRow>(
        'SELECT * FROM printers WHERE branch_id = ? AND id = ?',
      )
      .get(branchId, id);
    return row && toPrinter(row);
  }

  insertPrinter(branchId: string, r: PrinterRecord, at: Date): void {
    const t = at.toISOString();
    this.db
      .prepare(
        `INSERT INTO printers (id, branch_id, name, connection, address, paper_width_mm, purpose, station_id,
                               device_id, is_active, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        r.id,
        branchId,
        r.name,
        r.connection,
        r.address,
        r.paperWidthMm,
        r.purpose,
        r.stationId,
        r.deviceId,
        t,
        t,
        r.version,
      );
  }

  updatePrinter(branchId: string, r: PrinterRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE printers SET name = ?, connection = ?, address = ?, paper_width_mm = ?, purpose = ?, station_id = ?,
                device_id = ?, is_active = ?, updated_at = ?, version = ?
          WHERE branch_id = ? AND id = ? AND version = ?`,
      )
      .run(
        r.name,
        r.connection,
        r.address,
        r.paperWidthMm,
        r.purpose,
        r.stationId,
        r.deviceId,
        r.isActive ? 1 : 0,
        at.toISOString(),
        r.version,
        branchId,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'Printer', r.id);
  }

  private settingsOf(branchId: string): Map<string, unknown> {
    const rows = this.db
      .prepare<[string], { key: string; value_json: string }>(
        'SELECT key, value_json FROM settings WHERE branch_id = ?',
      )
      .all(branchId);
    return new Map(rows.map((r) => [r.key, JSON.parse(r.value_json) as unknown]));
  }

  private toTaxGroup(r: TaxGroupRow): TaxGroupRecord {
    const components = this.db
      .prepare<
        [string],
        {
          code: TaxComponentRecord['code'];
          rate_bp: number;
          applies_to: TaxComponentRecord['appliesTo'];
        }
      >(
        'SELECT code, rate_bp, applies_to FROM tax_components WHERE tax_group_id = ? ORDER BY sort_order',
      )
      .all(r.id)
      .map((c) => ({ code: c.code, rateBp: c.rate_bp, appliesTo: c.applies_to }));
    return {
      id: r.id,
      name: r.name,
      taxType: r.tax_type,
      taxCategory: r.tax_category,
      invoiceSeries: r.invoice_series,
      isInclusive: r.is_inclusive === 1,
      components,
      isActive: r.deleted_at === null,
      version: r.version,
    };
  }
}

interface TaxGroupRow {
  id: string;
  name: string;
  tax_type: TaxGroupRecord['taxType'];
  tax_category: TaxGroupRecord['taxCategory'];
  invoice_series: TaxGroupRecord['invoiceSeries'];
  is_inclusive: number;
  deleted_at: string | null;
  version: number;
}

interface ChargeRow {
  id: string;
  name: string;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  order_types: string;
  tax_group_id: string | null;
  is_optional: number;
  is_active: number;
  version: number;
}

interface PrinterRow {
  id: string;
  name: string;
  connection: PrinterRecord['connection'];
  address: string | null;
  paper_width_mm: 58 | 80;
  purpose: PrinterRecord['purpose'];
  station_id: string | null;
  device_id: string | null;
  is_active: number;
  version: number;
}

function toChargeRule(r: ChargeRow): ChargeRuleRecord {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    value: r.value,
    orderTypes: JSON.parse(r.order_types) as string[],
    taxGroupId: r.tax_group_id,
    isOptional: r.is_optional === 1,
    isActive: r.is_active === 1,
    version: r.version,
  };
}

function toPrinter(r: PrinterRow): PrinterRecord {
  return {
    id: r.id,
    name: r.name,
    connection: r.connection,
    address: r.address,
    paperWidthMm: r.paper_width_mm,
    purpose: r.purpose,
    stationId: r.station_id,
    deviceId: r.device_id,
    isActive: r.is_active === 1,
    version: r.version,
  };
}
