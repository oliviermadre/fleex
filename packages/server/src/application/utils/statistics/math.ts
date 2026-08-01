/**
 * Small numeric helpers shared by the statistics aggregates.
 *
 * The averages return `null` rather than `NaN` for an empty input because every
 * `avg*` field in `StatisticsResponse` is typed `number | null` and the charts
 * read `null` as "no data" — a `NaN` would render as a gap-less zero.
 */

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Arithmetic mean, or `null` when there is nothing to average. */
export function avg(values: readonly number[]): number | null {
  return values.length > 0 ? sum(values) / values.length : null;
}

/** Arithmetic mean rounded to the nearest integer, or `null` when empty. */
export function roundedAvg(values: readonly number[]): number | null {
  return values.length > 0 ? Math.round(sum(values) / values.length) : null;
}

/**
 * Nearest-rank percentile over an **already ascending** array.
 *
 * Uses the index `floor(p/100 * n)` clamped to the last element, so `p=50` on
 * an even-length array returns the upper of the two middle values.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}
