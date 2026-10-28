/** Small, dependency-free statistics for the measurement page. */

export interface Summary {
  readonly n: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly mean: number;
}

/** Nearest-rank percentile (p in 0–100) of a non-empty sample. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new RangeError('percentile of an empty sample');
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function summarize(samples: readonly number[]): Summary {
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    n: samples.length,
    min: round(Math.min(...samples)),
    p50: round(percentile(samples, 50)),
    p95: round(percentile(samples, 95)),
    max: round(Math.max(...samples)),
    mean: round(samples.reduce((a, b) => a + b, 0) / samples.length),
  };
}

/** Bytes over milliseconds → KB/s (1 KB = 1000 B), one decimal. */
export function kbPerSecond(bytes: number, ms: number): number {
  return ms <= 0 ? 0 : Math.round((bytes / ms) * 10) / 10;
}
