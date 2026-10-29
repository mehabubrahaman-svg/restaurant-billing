-- Phase 5 (CRM): membership tiers. A guest reaches a tier by lifetime spend
-- and visits (customers.lifetime_value, customers.visit_count); the tier is
-- worked out when it is read, so changing a tier's thresholds moves guests at
-- once. customers.membership_tier (since 0001) holds a tier a manager gave the
-- guest by hand, which then applies whatever they have spent.

CREATE TABLE membership_tiers (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    min_spend       INTEGER NOT NULL DEFAULT 0 CHECK (min_spend >= 0),        -- paise
    min_visits      INTEGER NOT NULL DEFAULT 0 CHECK (min_visits >= 0),
    -- Loyalty points earned × this / 10000 (10000 = no change).
    points_multiplier_bp INTEGER NOT NULL DEFAULT 10000 CHECK (points_multiplier_bp BETWEEN 0 AND 100000),
    -- Taken off every bill with the guest on it (invoice_discounts kind LOYALTY).
    discount_bp     INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    updated_at      TEXT NOT NULL,
    updated_by      TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (organization_id, name)
) STRICT;

CREATE TRIGGER trg_membership_tiers_no_delete BEFORE DELETE ON membership_tiers
BEGIN SELECT RAISE(ABORT, 'membership_tiers cannot be deleted; set is_active = 0'); END;
