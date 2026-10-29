export interface BranchSettingsRecord {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  stateCode: string;
  stateName: string;
  gstin: string | null;
  vatTin: string | null;
  exciseLicenceNo: string | null;
  liquorEnabled: boolean;
  liquorInvoice: 'SAME' | 'SEPARATE';
  cashRounding: number;
  /** billing.discount_limit_bp: the most staff may discount without a manager (default 10%). */
  discountLimitBp: number;
  defaultLocale: string;
  receiptLanguages: string[];
  receiptHeader: string;
  receiptFooter: string;
  dayStartsAt: string;
  /** loyalty.*: the branch's loyalty program (off until the owner turns it on). */
  loyaltyEnabled: boolean;
  loyaltyEarnPer100: number;
  loyaltyPointValue: number;
  loyaltyMinRedeem: number;
  version: number;
}

export interface TaxComponentRecord {
  code: 'CGST' | 'SGST' | 'IGST' | 'VAT' | 'SURCHARGE' | 'CESS';
  rateBp: number;
  appliesTo: 'ALWAYS' | 'INTRA_STATE' | 'INTER_STATE';
}

export interface TaxGroupRecord {
  id: string;
  name: string;
  taxType: 'GST' | 'VAT' | 'NONE';
  taxCategory: 'TAXABLE' | 'NIL_RATED' | 'EXEMPT' | 'NON_GST';
  invoiceSeries: 'INV' | 'LIQ';
  isInclusive: boolean;
  components: TaxComponentRecord[];
  isActive: boolean;
  version: number;
}

export interface ChargeRuleRecord {
  id: string;
  name: string;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  orderTypes: string[];
  taxGroupId: string | null;
  isOptional: boolean;
  isActive: boolean;
  version: number;
}

export interface PrinterRecord {
  id: string;
  name: string;
  connection: 'USB' | 'NETWORK' | 'BLUETOOTH' | 'BLE' | 'SYSTEM';
  address: string | null;
  paperWidthMm: 58 | 80;
  purpose: 'BILL' | 'KOT' | 'REPORT' | 'LABEL';
  stationId: string | null;
  deviceId: string | null;
  isActive: boolean;
  version: number;
}

/**
 * Versioned records. `update` writes `next` only if the stored version still
 * equals `next.version - 1`, and throws VERSION_CONFLICT otherwise.
 */
export interface SettingsRepository {
  branch(branchId: string): BranchSettingsRecord | undefined;
  updateBranch(branchId: string, next: BranchSettingsRecord, at: Date): void;

  taxGroups(): TaxGroupRecord[];
  taxGroup(id: string): TaxGroupRecord | undefined;
  insertTaxGroup(record: TaxGroupRecord, at: Date): void;
  updateTaxGroup(record: TaxGroupRecord, at: Date): void;

  chargeRules(branchId: string): ChargeRuleRecord[];
  chargeRule(branchId: string, id: string): ChargeRuleRecord | undefined;
  insertChargeRule(branchId: string, record: ChargeRuleRecord, at: Date): void;
  updateChargeRule(branchId: string, record: ChargeRuleRecord, at: Date): void;

  printers(branchId: string): PrinterRecord[];
  printer(branchId: string, id: string): PrinterRecord | undefined;
  insertPrinter(branchId: string, record: PrinterRecord, at: Date): void;
  updatePrinter(branchId: string, record: PrinterRecord, at: Date): void;
}
