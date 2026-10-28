import { describe, expect, it } from 'vitest';
import { filler } from './bench-protocol';
import { kbPerSecond, percentile, summarize } from './stats';

describe('stats', () => {
  it('computes nearest-rank percentiles', () => {
    const samples = Array.from({ length: 100 }, (_, i) => 100 - i); // 1…100, unsorted
    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 95)).toBe(95);
    expect(percentile(samples, 100)).toBe(100);
    expect(percentile(samples, 0)).toBe(1);
    expect(percentile([7], 95)).toBe(7);
    expect(() => percentile([], 50)).toThrow(RangeError);
  });

  it('summarizes a sample', () => {
    expect(summarize([10, 20, 30, 40])).toEqual({
      n: 4,
      min: 10,
      p50: 20,
      p95: 40,
      max: 40,
      mean: 25,
    });
  });

  it('converts to KB/s', () => {
    expect(kbPerSecond(100_000, 10_000)).toBe(10);
    expect(kbPerSecond(1_000, 0)).toBe(0);
  });

  it('builds deterministic JSON-safe filler', () => {
    expect(filler(64)).toHaveLength(64);
    expect(filler(64)).toBe(filler(64));
    expect(JSON.stringify(filler(1_000))).toHaveLength(1_002);
  });
});
