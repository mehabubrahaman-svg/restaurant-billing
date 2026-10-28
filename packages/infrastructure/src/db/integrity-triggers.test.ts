import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  TEST_BRANCH_ID,
  TEST_ORG_ID,
  TEST_USER_ID,
  type TestDatabase,
} from '../testing/test-database';

let t: TestDatabase;
beforeEach(() => (t = createTestDatabase()));
afterEach(() => t.close());

const T = '2026-10-28T12:00:00.000Z';

describe('database integrity guards', () => {
  it('every table with soft delete also blocks physical DELETE', () => {
    const tables = t.db
      .prepare<[], string>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .pluck()
      .all();
    const softDelete = tables.filter((name) =>
      (t.db.pragma(`table_info(${name})`) as { name: string }[]).some(
        (c) => c.name === 'deleted_at',
      ),
    );
    const guarded = new Set(
      t.db
        .prepare<[], string>(
          "SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%BEFORE DELETE%'",
        )
        .pluck()
        .all(),
    );
    expect(softDelete.length).toBeGreaterThan(20);
    expect(softDelete.filter((name) => !guarded.has(name))).toEqual([]);
    expect(() => t.db.prepare('DELETE FROM branches').run()).toThrow(/cannot be deleted/);
    expect(() => t.db.prepare('DELETE FROM users').run()).toThrow(/cannot be deleted/);
  });

  it('allows removing purchase order lines only while the PO is a draft', () => {
    t.db.exec(`
      INSERT INTO vendors (id, organization_id, code, name, created_at, updated_at)
        VALUES ('v1', '${TEST_ORG_ID}', 'V1', 'Fresh Farms', '${T}', '${T}');
      INSERT INTO inventory_items (id, organization_id, sku, name, base_unit_code, created_at, updated_at)
        VALUES ('rice', '${TEST_ORG_ID}', 'RICE', 'Basmati Rice', 'g', '${T}', '${T}');
      INSERT INTO purchase_orders (id, branch_id, vendor_id, po_no, created_at, created_by, updated_at)
        VALUES ('po1', '${TEST_BRANCH_ID}', 'v1', 'PO-1', '${T}', '${TEST_USER_ID}', '${T}');
      INSERT INTO purchase_order_lines (id, purchase_order_id, inventory_item_id, unit_id, quantity_milli, unit_price)
        VALUES ('l1', 'po1', 'rice', 'unit-kg', 25000, 9000), ('l2', 'po1', 'rice', 'unit-kg', 1000, 9000);
    `);
    expect(() =>
      t.db.prepare("DELETE FROM purchase_order_lines WHERE id = 'l1'").run(),
    ).not.toThrow();
    t.db.prepare("UPDATE purchase_orders SET status = 'APPROVED'").run();
    expect(() => t.db.prepare("DELETE FROM purchase_order_lines WHERE id = 'l2'").run()).toThrow(
      /DRAFT/,
    );
  });

  it('allows removing GRN lines only while the GRN is a draft', () => {
    t.db.exec(`
      INSERT INTO vendors (id, organization_id, code, name, created_at, updated_at)
        VALUES ('v1', '${TEST_ORG_ID}', 'V1', 'Fresh Farms', '${T}', '${T}');
      INSERT INTO inventory_items (id, organization_id, sku, name, base_unit_code, created_at, updated_at)
        VALUES ('rice', '${TEST_ORG_ID}', 'RICE', 'Basmati Rice', 'g', '${T}', '${T}');
      INSERT INTO grns (id, branch_id, vendor_id, grn_no, business_date, created_at, created_by, updated_at)
        VALUES ('g1', '${TEST_BRANCH_ID}', 'v1', 'GRN-1', '2026-10-28', '${T}', '${TEST_USER_ID}', '${T}');
      INSERT INTO grn_lines (id, grn_id, inventory_item_id, unit_id, quantity_milli, unit_price)
        VALUES ('l1', 'g1', 'rice', 'unit-kg', 25000, 9000), ('l2', 'g1', 'rice', 'unit-kg', 1000, 9000);
    `);
    expect(() => t.db.prepare("DELETE FROM grn_lines WHERE id = 'l1'").run()).not.toThrow();
    t.db.prepare("UPDATE grns SET status = 'POSTED'").run();
    expect(() => t.db.prepare("DELETE FROM grn_lines WHERE id = 'l2'").run()).toThrow(/DRAFT/);
  });

  it('keeps payments append-only: no UPDATE, no DELETE', () => {
    t.db.exec(`
      INSERT INTO orders (id, branch_id, order_no, business_date, order_type, opened_at, created_at, created_by, updated_at)
        VALUES ('o1', '${TEST_BRANCH_ID}', '1', '2026-10-28', 'TAKEAWAY', '${T}', '${T}', '${TEST_USER_ID}', '${T}');
      INSERT INTO invoices (id, branch_id, order_id, invoice_no, business_date, fiscal_year, subtotal,
                            taxable_total, tax_total, grand_total, created_at, created_by, updated_at)
        VALUES ('i1', '${TEST_BRANCH_ID}', 'o1', 'KOL1/2026-27/000001', '2026-10-28', '2026-27', 10000,
                10000, 500, 10500, '${T}', '${TEST_USER_ID}', '${T}');
      INSERT INTO payments (id, branch_id, invoice_id, method, amount, business_date, created_at, created_by)
        VALUES ('p1', '${TEST_BRANCH_ID}', 'i1', 'CASH', 10500, '2026-10-28', '${T}', '${TEST_USER_ID}');
    `);
    expect(() => t.db.prepare('UPDATE payments SET amount = 1').run()).toThrow(/append-only/);
    expect(() => t.db.prepare('DELETE FROM payments').run()).toThrow(/append-only/);
    expect(() => t.db.prepare('DELETE FROM invoices').run()).toThrow(/cannot be deleted/);
    expect(() => t.db.prepare('DELETE FROM orders').run()).toThrow(/cannot be deleted/);
  });

  it('rejects a journal line with both debit and credit, and keeps journals append-only', () => {
    // Every organisation gets the chart of accounts; the system posts with no user.
    const cash = `${TEST_ORG_ID}:1000`;
    expect(t.db.prepare('SELECT system_tag FROM accounts WHERE id = ?').pluck().get(cash)).toBe(
      'CASH',
    );
    t.db.exec(`
      INSERT INTO journal_entries (id, branch_id, entry_no, entry_date, source_type, created_at, created_by)
        VALUES ('j1', '${TEST_BRANCH_ID}', 'JE1', '2026-10-28', 'STOCK', '${T}', NULL);
    `);
    const line = (debit: number, credit: number) =>
      t.db
        .prepare(
          'INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?, ?)',
        )
        .run(`l${debit}${credit}`, 'j1', cash, debit, credit);
    expect(() => line(100, 100)).toThrow(/CHECK constraint/);
    expect(() => line(0, 0)).toThrow(/CHECK constraint/);
    expect(() => line(100, 0)).not.toThrow();
    expect(() => t.db.prepare('UPDATE journal_lines SET debit = 1').run()).toThrow(/append-only/);
    expect(() => t.db.prepare("DELETE FROM journal_entries WHERE id = 'j1'").run()).toThrow(
      /append-only/,
    );
  });

  it('rejects a branch in an unknown state', () => {
    expect(() =>
      t.db
        .prepare(
          `INSERT INTO branches (id, organization_id, code, name, state_code, created_at, updated_at)
           VALUES ('b2', ?, 'X', 'X', '99', ?, ?)`,
        )
        .run(TEST_ORG_ID, T, T),
    ).toThrow(/FOREIGN KEY/);
  });

  it('rejects wrong column types (STRICT tables)', () => {
    expect(() =>
      t.db
        .prepare(
          `INSERT INTO categories (id, organization_id, name, sort_order, created_at, updated_at)
           VALUES ('c1', ?, 'Biryani', 'first', ?, ?)`,
        )
        .run(TEST_ORG_ID, T, T),
    ).toThrow(/cannot store TEXT value in INTEGER column/);
  });
});
