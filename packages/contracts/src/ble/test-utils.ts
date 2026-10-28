/** Test helpers for the BLE codec. Not exported from the package. */

/** Deterministic pseudo-random bytes (xorshift32), so failures are reproducible. */
export function testBytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

/** A clock the test advances by hand. */
export function manualClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}
