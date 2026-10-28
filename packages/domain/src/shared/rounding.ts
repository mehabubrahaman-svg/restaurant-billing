export type RoundingMode = 'HALF_EVEN' | 'HALF_UP' | 'DOWN' | 'UP';

/**
 * Divides two bigints and rounds the quotient. All money and quantity
 * arithmetic funnels through here so rounding is defined in exactly one place.
 */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new RangeError('division by zero');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const quotient = numerator / denominator; // truncates toward zero
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;

  const sign = numerator < 0n ? -1n : 1n;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  switch (mode) {
    case 'DOWN':
      return quotient;
    case 'UP':
      return quotient + sign;
    case 'HALF_UP':
      return twiceRemainder >= denominator ? quotient + sign : quotient;
    case 'HALF_EVEN':
      if (twiceRemainder > denominator) return quotient + sign;
      if (twiceRemainder < denominator) return quotient;
      return quotient % 2n === 0n ? quotient : quotient + sign;
  }
}

export function toSafeNumber(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${what} out of safe integer range: ${value}`);
  }
  return Number(value);
}
