-- Phase 5 (CRM): loyalty points. Guests earn points on paid bills and spend
-- them as a tender (payments.method LOYALTY, already allowed by 0001). The
-- program's settings live in `settings` (loyalty.*); the ledger is
-- loyalty_transactions, append-only since 0001, with customers.loyalty_points
-- as its cached balance.

-- Why a manager added or took away points ("birthday gift", "wrong phone").
ALTER TABLE loyalty_transactions ADD COLUMN note TEXT;

CREATE INDEX ix_loyalty_customer ON loyalty_transactions(customer_id, created_at);
CREATE INDEX ix_loyalty_invoice ON loyalty_transactions(invoice_id) WHERE invoice_id IS NOT NULL;
