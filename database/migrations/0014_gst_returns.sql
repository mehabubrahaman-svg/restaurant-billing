-- Phase 5 (Reporting): GST returns. GSTR-1 table 14 lists supplies made
-- through e-commerce operators who pay the GST under section 9(5) (Swiggy,
-- Zomato, ...) by the operator's GSTIN, so a sales channel can carry it.
ALTER TABLE sales_channels ADD COLUMN operator_gstin TEXT
    CHECK (operator_gstin IS NULL OR length(operator_gstin) = 15);
