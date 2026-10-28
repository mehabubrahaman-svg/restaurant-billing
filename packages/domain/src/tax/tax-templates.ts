export interface TaxComponentTemplate {
  readonly code: 'CGST' | 'SGST' | 'IGST' | 'VAT' | 'SURCHARGE' | 'CESS';
  readonly rateBp: number;
  readonly appliesTo: 'ALWAYS' | 'INTRA_STATE' | 'INTER_STATE';
}

export interface TaxGroupTemplate {
  readonly name: string;
  readonly taxType: 'GST' | 'VAT' | 'NONE';
  readonly taxCategory: 'TAXABLE' | 'NIL_RATED' | 'EXEMPT' | 'NON_GST';
  readonly invoiceSeries: 'INV' | 'LIQ';
  readonly components: readonly TaxComponentTemplate[];
}

/** A GST rate split into CGST + SGST (same state) and IGST (other state). */
export function gstGroup(name: string, rateBp: number): TaxGroupTemplate {
  if (rateBp % 2 !== 0) throw new RangeError('GST rate must split evenly into CGST and SGST');
  return {
    name,
    taxType: 'GST',
    taxCategory: rateBp === 0 ? 'NIL_RATED' : 'TAXABLE',
    invoiceSeries: 'INV',
    components:
      rateBp === 0
        ? []
        : [
            { code: 'CGST', rateBp: rateBp / 2, appliesTo: 'INTRA_STATE' },
            { code: 'SGST', rateBp: rateBp / 2, appliesTo: 'INTRA_STATE' },
            { code: 'IGST', rateBp, appliesTo: 'INTER_STATE' },
          ],
  };
}

/**
 * GST groups created at setup. Rates are data: the owner (with their tax
 * advisor) can change or add groups in Settings → Taxes at any time.
 * 5% is the usual rate for restaurant service; 18% covers items and outlets
 * taxed at the standard rate; 0% is for nil-rated items.
 */
export const DEFAULT_GST_GROUPS: readonly TaxGroupTemplate[] = [
  gstGroup('GST 5%', 500),
  gstGroup('GST 18%', 1800),
  gstGroup('GST 0%', 0),
];

/** State VAT on alcoholic liquor (outside GST). The rate always comes from the owner. */
export function liquorVatGroup(
  vatRateBp: number,
  surchargeBp: number,
  separateInvoice: boolean,
): TaxGroupTemplate {
  return {
    name: `Liquor VAT ${vatRateBp / 100}%`,
    taxType: 'VAT',
    taxCategory: 'TAXABLE',
    invoiceSeries: separateInvoice ? 'LIQ' : 'INV',
    components: [
      { code: 'VAT', rateBp: vatRateBp, appliesTo: 'ALWAYS' },
      ...(surchargeBp > 0
        ? [{ code: 'SURCHARGE' as const, rateBp: surchargeBp, appliesTo: 'ALWAYS' as const }]
        : []),
    ],
  };
}
