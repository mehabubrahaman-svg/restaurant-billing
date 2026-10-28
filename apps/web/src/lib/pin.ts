/**
 * Mirrors the Hub's PIN_TOO_WEAK rule so people find out while typing:
 * all one digit (1111) or a straight run up or down (1234, 4321).
 */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{4,6}$/.test(pin)) return false;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}
