-- 0008: billing details (Sprint 5).

-- Per-line tax breakdown, so GST HSN summaries, credit notes and reprints
-- never have to recompute tax from today's rates.
ALTER TABLE invoice_lines ADD COLUMN tax_group_id TEXT REFERENCES tax_groups(id);
ALTER TABLE invoice_lines ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_lines ADD COLUMN taxes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(taxes_json));
-- Credit-note lines point at the invoice line they refund.
ALTER TABLE invoice_lines ADD COLUMN original_line_id TEXT REFERENCES invoice_lines(id);

ALTER TABLE invoice_charges ADD COLUMN tax_group_id TEXT REFERENCES tax_groups(id);
ALTER TABLE invoice_charges ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_charges ADD COLUMN taxes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(taxes_json));

ALTER TABLE invoice_discounts ADD COLUMN coupon_code TEXT;

-- Snapshot of the buyer for B2B tax invoices (the GSTIN is customer_tax_id).
ALTER TABLE invoices ADD COLUMN customer_name TEXT;
-- Refunds against this invoice so far (credit notes), for its REFUNDED / PARTIALLY_REFUNDED status.
ALTER TABLE invoices ADD COLUMN refunded_total INTEGER NOT NULL DEFAULT 0;

ALTER TABLE cash_shifts ADD COLUMN denominations_json TEXT CHECK (denominations_json IS NULL OR json_valid(denominations_json));
ALTER TABLE cash_shifts ADD COLUMN notes TEXT;

CREATE INDEX ix_payments_shift ON payments(shift_id);
CREATE UNIQUE INDEX ux_cash_shifts_open_device ON cash_shifts(branch_id, coalesce(device_id, opened_by)) WHERE status = 'OPEN';
