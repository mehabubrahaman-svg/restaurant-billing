import { describe, expect, it } from 'vitest';
import { gstinCheckCharacter, gstinProblem } from './gstin';

describe('GSTIN', () => {
  it('computes the check character (known valid GSTINs)', () => {
    expect(gstinCheckCharacter('27AAPFU0939F1Z')).toBe('V');
    expect(gstinCheckCharacter('33AAACH7409R1Z')).toBe('8');
  });

  it('accepts a valid GSTIN for its own state, in any case', () => {
    expect(gstinProblem('27AAPFU0939F1ZV', '27')).toBeNull();
    expect(gstinProblem(' 27aapfu0939f1zv ', '27')).toBeNull();
  });

  it('rejects a bad shape, a wrong state and a wrong check character', () => {
    expect(gstinProblem('27AAPFU0939F1Z', '27')).toBe('format');
    expect(gstinProblem('27AAPFU0939F1XV', '27')).toBe('format');
    expect(gstinProblem('27AAPFU0939F1ZV', '19')).toBe('state');
    expect(gstinProblem('27AAPFU0939F1ZW', '27')).toBe('checksum');
  });
});
