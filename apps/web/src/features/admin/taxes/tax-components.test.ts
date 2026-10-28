import { describe, expect, it } from 'vitest';
import { gstComponents, simpleGstRate, simpleVat, vatComponents } from './tax-components';

describe('gstComponents', () => {
  it('splits a GST rate into CGST + SGST within the state and IGST across states', () => {
    expect(gstComponents(500)).toEqual([
      { code: 'CGST', rateBp: 250, appliesTo: 'INTRA_STATE' },
      { code: 'SGST', rateBp: 250, appliesTo: 'INTRA_STATE' },
      { code: 'IGST', rateBp: 500, appliesTo: 'INTER_STATE' },
    ]);
    expect(gstComponents(1800)?.[0]?.rateBp).toBe(900);
  });

  it('rejects rates that cannot be halved exactly', () => {
    expect(gstComponents(25)).toBeNull();
    expect(gstComponents(-2)).toBeNull();
  });

  it('recognises its own output for the simple editor', () => {
    expect(simpleGstRate(gstComponents(1200)!)).toBe(1200);
    expect(simpleGstRate([{ code: 'IGST', rateBp: 500, appliesTo: 'INTER_STATE' }])).toBeNull();
    const custom = [...gstComponents(500)!];
    custom[0] = { code: 'CGST', rateBp: 200, appliesTo: 'INTRA_STATE' };
    expect(simpleGstRate(custom)).toBeNull();
  });
});

describe('vatComponents', () => {
  it('adds the surcharge only when set', () => {
    expect(vatComponents(2000, 0)).toEqual([{ code: 'VAT', rateBp: 2000, appliesTo: 'ALWAYS' }]);
    expect(vatComponents(2000, 1000)).toHaveLength(2);
  });

  it('round-trips through simpleVat', () => {
    expect(simpleVat(vatComponents(2000, 1000))).toEqual({ vatBp: 2000, surchargeBp: 1000 });
    expect(simpleVat(vatComponents(2000, 0))).toEqual({ vatBp: 2000, surchargeBp: 0 });
    expect(simpleVat(gstComponents(500)!)).toBeNull();
  });
});
