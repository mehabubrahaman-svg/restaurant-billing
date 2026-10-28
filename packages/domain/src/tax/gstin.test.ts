import { describe, expect, it } from 'vitest';
import { DomainError } from '../shared/result';
import { gstinCheckCharacter, parseGstin } from './gstin';

describe('GSTIN', () => {
  // Published sample GSTINs with correct check characters.
  it.each(['27AAPFU0939F1ZV', '29AAGCB7383J1Z4'])('accepts %s', (gstin) => {
    expect(parseGstin(gstin)).toBe(gstin);
  });

  it('normalises case and whitespace', () => {
    expect(parseGstin(' 27aapfu0939f1zv ')).toBe('27AAPFU0939F1ZV');
  });

  it('catches a single mistyped character', () => {
    expect(() => parseGstin('27AAPFU0939F1ZW')).toThrow(/check character/);
    expect(() => parseGstin('27AAPFU0938F1ZV')).toThrow(/check character/);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', '27AAPFU0939F1Z', '27AAPFU0939F1XV', 'AAAPFU0939F1ZVV']) {
      expect(() => parseGstin(bad)).toThrow(DomainError);
    }
  });

  it('checks the GSTIN belongs to the branch state', () => {
    expect(() => parseGstin('27AAPFU0939F1ZV', '19')).toThrow(
      expect.objectContaining({ code: 'GSTIN_STATE_MISMATCH' }),
    );
    expect(parseGstin('27AAPFU0939F1ZV', '27')).toBe('27AAPFU0939F1ZV');
  });

  it('computes the check character for a West Bengal GSTIN', () => {
    const first14 = '19AABCU9603R1Z';
    const gstin = first14 + gstinCheckCharacter(first14);
    expect(parseGstin(gstin, '19')).toBe(gstin);
  });
});
