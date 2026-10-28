import { describe, expect, it } from 'vitest';
import { DEFAULT_GST_GROUPS, gstGroup, liquorVatGroup } from './tax-templates';

describe('tax templates', () => {
  it('splits GST into CGST + SGST for intra-state and IGST for inter-state', () => {
    expect(gstGroup('GST 5%', 500).components).toEqual([
      { code: 'CGST', rateBp: 250, appliesTo: 'INTRA_STATE' },
      { code: 'SGST', rateBp: 250, appliesTo: 'INTRA_STATE' },
      { code: 'IGST', rateBp: 500, appliesTo: 'INTER_STATE' },
    ]);
  });

  it('marks 0% as nil-rated with no components', () => {
    expect(gstGroup('GST 0%', 0)).toMatchObject({ taxCategory: 'NIL_RATED', components: [] });
  });

  it('creates 5%, 18% and 0% groups by default', () => {
    expect(DEFAULT_GST_GROUPS.map((g) => g.name)).toEqual(['GST 5%', 'GST 18%', 'GST 0%']);
  });

  it('puts liquor on the LIQ series when billed separately', () => {
    expect(liquorVatGroup(2000, 0, true)).toMatchObject({ taxType: 'VAT', invoiceSeries: 'LIQ' });
    expect(liquorVatGroup(2000, 0, false).invoiceSeries).toBe('INV');
    expect(liquorVatGroup(2000, 500, true).components.map((c) => c.code)).toEqual([
      'VAT',
      'SURCHARGE',
    ]);
  });
});
