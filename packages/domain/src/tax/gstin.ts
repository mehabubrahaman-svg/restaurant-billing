import { DomainError } from '../shared/result';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * The 15th character of a GSTIN is a check character over the first 14
 * (base-36, alternating weights 1 and 2, digit sums of each product).
 */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = ALPHABET.indexOf(first14[i]!);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36]!;
}

/**
 * Validates format, check character and (optionally) that the GSTIN was
 * issued in the branch's state: the first two digits are the GST state code.
 * Returns the normalised (upper-case, trimmed) GSTIN.
 */
export function parseGstin(input: string, expectedStateCode?: string): string {
  const gstin = input.trim().toUpperCase();
  if (!FORMAT.test(gstin)) throw new DomainError('GSTIN_INVALID', `"${input}" is not a GSTIN`);
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14]) {
    throw new DomainError('GSTIN_INVALID', `GSTIN ${gstin} has a wrong check character (typo?)`);
  }
  if (expectedStateCode !== undefined && gstin.slice(0, 2) !== expectedStateCode) {
    throw new DomainError(
      'GSTIN_STATE_MISMATCH',
      `GSTIN ${gstin} is registered in state ${gstin.slice(0, 2)}, but the branch is in state ${expectedStateCode}`,
      { gstinState: gstin.slice(0, 2), branchState: expectedStateCode },
    );
  }
  return gstin;
}
