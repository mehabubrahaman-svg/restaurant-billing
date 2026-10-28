const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The 15th character of a GSTIN, from its first 14 (mod-36 weighted checksum). */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARSET.indexOf(first14[i] ?? '') * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36]!;
}

export type GstinProblem = 'format' | 'state' | 'checksum';

/**
 * Client-side GSTIN checks, mirroring the Hub: shape, state code prefix and
 * check digit. `null` when the GSTIN looks right.
 */
export function gstinProblem(raw: string, stateCode: string): GstinProblem | null {
  const gstin = raw.trim().toUpperCase();
  if (!FORMAT.test(gstin)) return 'format';
  if (stateCode !== '' && gstin.slice(0, 2) !== stateCode) return 'state';
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14]) return 'checksum';
  return null;
}
