import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { divideRounded } from './rounding';

describe('divideRounded', () => {
  it.each([
    [5n, 2n, 'HALF_EVEN', 2n],
    [7n, 2n, 'HALF_EVEN', 4n],
    [-5n, 2n, 'HALF_EVEN', -2n],
    [-7n, 2n, 'HALF_EVEN', -4n],
    [5n, 2n, 'HALF_UP', 3n],
    [-5n, 2n, 'HALF_UP', -3n],
    [5n, 3n, 'DOWN', 1n],
    [-5n, 3n, 'DOWN', -1n],
    [4n, 3n, 'UP', 2n],
    [-4n, 3n, 'UP', -2n],
    [6n, 3n, 'UP', 2n],
    [5n, -2n, 'HALF_UP', -3n],
  ] as const)('%s / %s (%s) = %s', (n, d, mode, expected) => {
    expect(divideRounded(n, d, mode)).toBe(expected);
  });

  it('rejects division by zero', () => {
    expect(() => divideRounded(1n, 0n, 'DOWN')).toThrow(RangeError);
  });

  it('is never more than half a unit away from the exact quotient', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        fc.constantFrom('HALF_EVEN', 'HALF_UP'),
        (n, d, mode) => {
          const q = divideRounded(n, d, mode);
          const diff = q * d - n; // error scaled by d
          return (diff < 0n ? -diff : diff) * 2n <= d;
        },
      ),
    );
  });
});
