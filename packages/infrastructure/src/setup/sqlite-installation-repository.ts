import type {
  IndianStateInfo,
  InstallationPlan,
  InstallationRepository,
  ReferenceData,
} from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';
import { SqliteRoleRepository } from '../identity/sqlite-role-repository';
import { SqliteUserRepository } from '../identity/sqlite-user-repository';

/** Writes a whole new installation. Runs inside the setup command's transaction. */
export class SqliteInstallationRepository implements InstallationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  isInstalled(): boolean {
    return this.db.prepare('SELECT EXISTS (SELECT 1 FROM organizations)').pluck().get() === 1;
  }

  create(plan: InstallationPlan): void {
    const db = this.db;
    const t = plan.createdAt.toISOString();
    const { organization: o, branch: b } = plan;

    db.prepare(
      'INSERT INTO organizations (id, name, legal_name, currency_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(o.id, o.name, o.legalName, 'INR', t, t);

    db.prepare(
      `INSERT INTO branches (id, organization_id, code, name, address, phone, tax_id, vat_tin,
                             excise_licence_no, state_code, default_locale, receipt_locales, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      b.id,
      o.id,
      b.code,
      b.name,
      b.address,
      b.phone,
      b.gstin,
      b.vatTin,
      b.exciseLicenceNo,
      b.stateCode,
      b.defaultLocale,
      JSON.stringify(b.receiptLanguages),
      t,
      t,
    );

    const setting = db.prepare(
      'INSERT INTO settings (id, branch_id, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const [key, value] of Object.entries(plan.settings)) {
      setting.run(`${b.id}:${key}`, b.id, key, JSON.stringify(value), t);
    }

    const now = () => plan.createdAt;
    const roles = new SqliteRoleRepository(db, now);
    for (const role of plan.roles) roles.insert(role);
    new SqliteUserRepository(db, now).insert(plan.admin);

    const group = db.prepare(
      `INSERT INTO tax_groups (id, organization_id, name, tax_type, tax_category, invoice_series, is_inclusive,
                               created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    const component = db.prepare(
      `INSERT INTO tax_components (id, tax_group_id, code, rate_bp, applies_to, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const g of plan.taxGroups) {
      group.run(g.id, o.id, g.name, g.taxType, g.taxCategory, g.invoiceSeries, t, t);
      g.components.forEach((c, i) =>
        component.run(`${g.id}:${i}`, g.id, c.code, c.rateBp, c.appliesTo, i),
      );
    }

    const sequence = db.prepare(
      'INSERT INTO document_sequences (branch_id, series, fiscal_year, next_value, prefix) VALUES (?, ?, ?, 1, ?)',
    );
    for (const s of plan.documentSeries) sequence.run(b.id, s.series, s.fiscalYear, s.prefix);

    db.prepare(
      `INSERT INTO sales_channels (id, organization_id, code, name, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'DIRECT', ?, ?)`,
    ).run(plan.salesChannel.id, o.id, plan.salesChannel.code, plan.salesChannel.name, t, t);

    const secret = db.prepare(
      'INSERT INTO system_secrets (name, value, created_at) VALUES (?, ?, ?)',
    );
    secret.run('backup.kdf', plan.backupKey.kdf, t);
    secret.run('backup.key', plan.backupKey.keyHex, t);
  }
}

export class SqliteReferenceData implements ReferenceData {
  constructor(private readonly db: SqliteDatabase) {}

  states(): IndianStateInfo[] {
    return this.db
      .prepare<
        [],
        {
          gst_state_code: string;
          name: string;
          region: string;
          rollout_wave: number;
          liquor_permitted: number;
          liquor_separate_invoice: number;
          local_locales: string;
        }
      >('SELECT * FROM indian_states ORDER BY name')
      .all()
      .map((r) => ({
        gstStateCode: r.gst_state_code,
        name: r.name,
        region: r.region,
        rolloutWave: r.rollout_wave,
        liquorPermitted: r.liquor_permitted === 1,
        liquorSeparateInvoice: r.liquor_separate_invoice === 1,
        localLocales: JSON.parse(r.local_locales) as string[],
      }));
  }
}
