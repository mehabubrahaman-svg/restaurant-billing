import type { TaxComponentBody } from '../../../api/endpoints';

/**
 * One GST rate → CGST + SGST (half each, within the state) and IGST (full,
 * inter-state). `null` if the rate cannot be halved in whole basis points.
 */
export function gstComponents(rateBp: number): TaxComponentBody[] | null {
  if (!Number.isSafeInteger(rateBp) || rateBp < 0 || rateBp % 2 !== 0) return null;
  const half = rateBp / 2;
  return [
    { code: 'CGST', rateBp: half, appliesTo: 'INTRA_STATE' },
    { code: 'SGST', rateBp: half, appliesTo: 'INTRA_STATE' },
    { code: 'IGST', rateBp, appliesTo: 'INTER_STATE' },
  ];
}

/** State VAT on liquor, plus an optional surcharge. */
export function vatComponents(vatBp: number, surchargeBp: number): TaxComponentBody[] {
  return [
    { code: 'VAT', rateBp: vatBp, appliesTo: 'ALWAYS' },
    ...(surchargeBp > 0
      ? [{ code: 'SURCHARGE' as const, rateBp: surchargeBp, appliesTo: 'ALWAYS' as const }]
      : []),
  ];
}

/** The single GST rate if `components` is exactly what gstComponents() makes, else null. */
export function simpleGstRate(components: readonly TaxComponentBody[]): number | null {
  const igst = components.find((c) => c.code === 'IGST');
  if (igst === undefined || components.length !== 3) return null;
  const expected = gstComponents(igst.rateBp);
  if (expected === null) return null;
  const same = expected.every((e) =>
    components.some(
      (c) => c.code === e.code && c.rateBp === e.rateBp && c.appliesTo === e.appliesTo,
    ),
  );
  return same ? igst.rateBp : null;
}

/** VAT and surcharge if `components` is a plain VAT group, else null. */
export function simpleVat(
  components: readonly TaxComponentBody[],
): { vatBp: number; surchargeBp: number } | null {
  const vat = components.find((c) => c.code === 'VAT' && c.appliesTo === 'ALWAYS');
  const surcharge = components.find((c) => c.code === 'SURCHARGE' && c.appliesTo === 'ALWAYS');
  const expectedLength = surcharge === undefined ? 1 : 2;
  if (vat === undefined || components.length !== expectedLength) return null;
  return { vatBp: vat.rateBp, surchargeBp: surcharge?.rateBp ?? 0 };
}
