-- Phase 3 (Purchase): what purchasing needs beyond the 0001 tables.

ALTER TABLE purchase_orders ADD COLUMN sent_at TEXT;
ALTER TABLE purchase_orders ADD COLUMN cancel_reason TEXT;

-- When the vendor's bill falls due (bill date + the vendor's payment terms), for dues ageing.
ALTER TABLE grns ADD COLUMN due_on TEXT;
ALTER TABLE grns ADD COLUMN notes TEXT;
ALTER TABLE grns ADD COLUMN cancel_reason TEXT;
-- How the bill's input tax is claimed, fixed when the GRN is posted: CGST + SGST
-- from a vendor in the branch's state, IGST from another state, NONE from an
-- unregistered vendor (no credit: the tax becomes part of the stock's cost).
ALTER TABLE grns ADD COLUMN input_tax_kind TEXT NOT NULL DEFAULT 'CGST_SGST'
    CHECK (input_tax_kind IN ('CGST_SGST','IGST','NONE'));

-- A draft GRN's lines can be replaced while it is edited, like a draft PO's.
DROP TRIGGER trg_grn_lines_no_delete;
CREATE TRIGGER trg_grn_lines_draft_only BEFORE DELETE ON grn_lines
WHEN (SELECT status FROM grns WHERE id = OLD.grn_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'GRN lines can only be removed while the GRN is a DRAFT'); END;

CREATE INDEX ix_purchase_orders_branch ON purchase_orders(branch_id, status, created_at);
CREATE INDEX ix_purchase_order_lines_po ON purchase_order_lines(purchase_order_id);
CREATE INDEX ix_grns_vendor ON grns(vendor_id, status, business_date);
CREATE INDEX ix_grns_po ON grns(purchase_order_id);
CREATE INDEX ix_grn_lines_grn ON grn_lines(grn_id);
CREATE INDEX ix_vendor_payments_vendor ON vendor_payments(vendor_id, paid_on);
CREATE INDEX ix_vendor_payments_grn ON vendor_payments(grn_id);
