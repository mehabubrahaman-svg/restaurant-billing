-- Phase 4 (Accounts): the chart of accounts, journals that the system posts
-- itself, and expenses.

-- The chart every organisation starts with. `system_tag` marks the accounts
-- automatic postings use (docs/03 §4.4); owners add their own beside them.
CREATE TABLE account_templates (
    code            TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
    system_tag      TEXT UNIQUE
) STRICT;

INSERT INTO account_templates (code, name, type, system_tag) VALUES
  ('1000', 'Cash in hand',              'ASSET',     'CASH'),
  ('1010', 'Bank account',              'ASSET',     'BANK'),
  ('1020', 'Card and UPI clearing',     'ASSET',     'CARD_UPI_CLEARING'),
  ('1100', 'Customer receivables',      'ASSET',     'AR'),
  ('1110', 'Aggregator receivables',    'ASSET',     'AGGREGATOR_RECEIVABLE'),
  ('1200', 'Inventory',                 'ASSET',     'INVENTORY'),
  ('1300', 'Input CGST',                'ASSET',     'INPUT_CGST'),
  ('1310', 'Input SGST',                'ASSET',     'INPUT_SGST'),
  ('1320', 'Input IGST',                'ASSET',     'INPUT_IGST'),
  ('2000', 'Vendor payables',           'LIABILITY', 'AP'),
  ('2100', 'Output CGST',               'LIABILITY', 'OUTPUT_CGST'),
  ('2110', 'Output SGST',               'LIABILITY', 'OUTPUT_SGST'),
  ('2120', 'Output IGST',               'LIABILITY', 'OUTPUT_IGST'),
  ('2130', 'GST cess payable',          'LIABILITY', 'OUTPUT_CESS'),
  ('2200', 'Output VAT on liquor',      'LIABILITY', 'OUTPUT_VAT'),
  ('2210', 'VAT surcharge payable',     'LIABILITY', 'OUTPUT_SURCHARGE'),
  ('3000', 'Owner''s capital',          'EQUITY',    'CAPITAL'),
  ('3100', 'Opening balance equity',    'EQUITY',    'OPENING_EQUITY'),
  ('3200', 'Retained earnings',         'EQUITY',    'RETAINED_EARNINGS'),
  ('4000', 'Food and beverage sales',   'INCOME',    'SALES_FOOD'),
  ('4010', 'Liquor sales',              'INCOME',    'SALES_LIQUOR'),
  ('4100', 'Service charge income',     'INCOME',    'SERVICE_CHARGE'),
  ('4200', 'Rounding',                  'INCOME',    'ROUND_OFF'),
  ('4900', 'Sales returns',             'INCOME',    'SALES_RETURNS'),
  ('5000', 'Cost of goods sold',        'EXPENSE',   'COGS'),
  ('5100', 'Wastage',                   'EXPENSE',   'WASTAGE'),
  ('5200', 'Stock adjustments',         'EXPENSE',   'STOCK_ADJUSTMENT'),
  ('5300', 'Aggregator commission',     'EXPENSE',   'AGGREGATOR_COMMISSION'),
  ('6000', 'Rent',                      'EXPENSE',   NULL),
  ('6010', 'Salaries and wages',        'EXPENSE',   NULL),
  ('6020', 'Electricity and gas',       'EXPENSE',   NULL),
  ('6030', 'Repairs and maintenance',   'EXPENSE',   NULL),
  ('6040', 'Marketing',                 'EXPENSE',   NULL),
  ('6090', 'Other expenses',            'EXPENSE',   'OTHER_EXPENSE');

-- Seeded accounts have readable ids (organisation id + code) so every Hub of
-- one organisation agrees on them; accounts added later get UUIDv7 ids.
INSERT INTO accounts (id, organization_id, code, name, type, system_tag, created_at, updated_at)
SELECT o.id || ':' || t.code, o.id, t.code, t.name, t.type, t.system_tag, o.created_at, o.created_at
  FROM organizations o CROSS JOIN account_templates t;

CREATE TRIGGER trg_organizations_seed_accounts AFTER INSERT ON organizations
BEGIN
  INSERT INTO accounts (id, organization_id, code, name, type, system_tag, created_at, updated_at)
  SELECT NEW.id || ':' || t.code, NEW.id, t.code, t.name, t.type, t.system_tag, NEW.created_at, NEW.created_at
    FROM account_templates t;
END;

-- Journals: postings the system makes have no user (created_by NULL), stock
-- movements post as STOCK, and a source document has one original entry.
-- Nothing wrote journals before this migration; the rows are copied anyway.
PRAGMA defer_foreign_keys = ON;
DROP VIEW v_unbalanced_journal_entries;
DROP VIEW v_account_ledger;

CREATE TABLE journal_entries_new (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL REFERENCES branches(id),
    entry_no        TEXT NOT NULL,
    entry_date      TEXT NOT NULL,
    source_type     TEXT NOT NULL CHECK (source_type IN ('INVOICE','CREDIT_NOTE','PAYMENT','GRN','VENDOR_PAYMENT','EXPENSE','STOCK','MANUAL')),
    source_id       TEXT,
    narration       TEXT,
    reversal_of_id  TEXT REFERENCES journal_entries(id),  -- corrections are reversals, never edits
    created_at      TEXT NOT NULL,
    created_by      TEXT REFERENCES users(id),             -- NULL: posted by the system
    UNIQUE (branch_id, entry_no)
) STRICT;
INSERT INTO journal_entries_new
SELECT id, branch_id, entry_no, entry_date,
       CASE source_type WHEN 'STOCK_ADJUSTMENT' THEN 'STOCK' ELSE source_type END,
       source_id, narration, reversal_of_id, created_at, created_by
  FROM journal_entries;

CREATE TABLE journal_lines_new (
    id              TEXT PRIMARY KEY,
    journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
    account_id      TEXT NOT NULL REFERENCES accounts(id),
    debit           INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit          INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
    party_type      TEXT CHECK (party_type IN ('CUSTOMER','VENDOR','EMPLOYEE')),  -- sub-ledgers
    party_id        TEXT,
    memo            TEXT,
    CHECK ((debit = 0) <> (credit = 0))         -- exactly one side non-zero
) STRICT;
INSERT INTO journal_lines_new SELECT * FROM journal_lines;

DROP TABLE journal_lines;
DROP TABLE journal_entries;
ALTER TABLE journal_entries_new RENAME TO journal_entries;
ALTER TABLE journal_lines_new RENAME TO journal_lines;

CREATE INDEX ix_journal_source ON journal_entries(source_type, source_id);
CREATE INDEX ix_journal_date ON journal_entries(branch_id, entry_date);
CREATE UNIQUE INDEX ux_journal_source_original ON journal_entries(source_type, source_id)
    WHERE reversal_of_id IS NULL AND source_id IS NOT NULL AND source_type NOT IN ('STOCK','MANUAL');
CREATE INDEX ix_journal_reversal ON journal_entries(reversal_of_id);
CREATE INDEX ix_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX ix_journal_lines_account ON journal_lines(account_id);
CREATE INDEX ix_journal_lines_party ON journal_lines(party_type, party_id);

CREATE TRIGGER trg_journal_entries_no_update BEFORE UPDATE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal_entries is append-only; post a reversal'); END;
CREATE TRIGGER trg_journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal_entries is append-only; post a reversal'); END;
CREATE TRIGGER trg_journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal_lines is append-only'); END;
CREATE TRIGGER trg_journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal_lines is append-only'); END;

CREATE VIEW v_unbalanced_journal_entries AS
SELECT je.id, SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
FROM journal_entries je
JOIN journal_lines jl ON jl.journal_entry_id = je.id
GROUP BY je.id
HAVING SUM(jl.debit) <> SUM(jl.credit);

CREATE VIEW v_account_ledger AS
SELECT jl.account_id, je.branch_id, je.entry_date, je.entry_no, je.source_type, je.source_id,
       jl.debit, jl.credit, jl.party_type, jl.party_id, COALESCE(jl.memo, je.narration) AS narration
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id;

-- Expenses: the bill number, and why one was cancelled (its journal is reversed).
ALTER TABLE expenses ADD COLUMN reference TEXT;
ALTER TABLE expenses ADD COLUMN cancel_reason TEXT;
CREATE INDEX ix_expenses_date ON expenses(branch_id, expense_date);
