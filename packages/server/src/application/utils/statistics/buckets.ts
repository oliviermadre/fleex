/**
 * Time bucketing for the statistics charts.
 *
 * Buckets tile `[from, to)` exactly: each bucket's `end` is the next bucket's
 * `start`, and the last one is clamped to `to`. Membership is therefore
 * `start <= t < end`, which means an item timestamped exactly `to` falls in no
 * bucket at all even though the range filter (which is inclusive of `to`)
 * accepts it. That asymmetry predates this module and is preserved.
 */

export interface StatsBucket {
  readonly start: Date;
  readonly end: Date;
  /** `start.getTime()`, precomputed — bucket assignment is a hot path. */
  readonly startMs: number;
  /** `end.getTime()`, precomputed. */
  readonly endMs: number;
  readonly label: string;
}

/**
 * Splits `[from, to)` into contiguous buckets.
 *
 * Day and week steps use `setDate`, and month uses `setMonth`, so bucket widths
 * follow *local* calendar rules (a DST day is 23 or 25 hours long). Month labels
 * likewise read local-time getters. This is long-standing behaviour that the
 * front-end's axis rendering depends on, so it is kept verbatim.
 */
export function buildBuckets(
  from: Date,
  to: Date,
  granularity: 'day' | 'week' | 'month',
): StatsBucket[] {
  const buckets: StatsBucket[] = [];
  let current = new Date(from);

  while (current < to) {
    const start = new Date(current);
    let end: Date;
    let label: string;

    switch (granularity) {
      case 'day':
        end = new Date(current);
        end.setDate(end.getDate() + 1);
        label = start.toISOString().split('T')[0]!;
        break;
      case 'week':
        end = new Date(current);
        end.setDate(end.getDate() + 7);
        label = start.toISOString().split('T')[0]!;
        break;
      case 'month':
        end = new Date(current);
        end.setMonth(end.getMonth() + 1);
        label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
        break;
    }

    if (end > to) end = new Date(to);
    buckets.push({ start, end, startMs: start.getTime(), endMs: end.getTime(), label });
    current = end;
  }

  return buckets;
}

/**
 * Index of the bucket containing `timeMs`, or `-1` if it falls outside them.
 *
 * Binary search over the (ascending, contiguous) bucket starts — this replaces
 * a per-bucket linear scan of every entity, which is what made the old
 * implementation quadratic in `buckets × entities`.
 *
 * `NaN` is rejected up front: the old `d >= start && d < end` comparisons were
 * both false for an unparseable date, leaving the item in no bucket, and a
 * binary search on `NaN` would otherwise wander.
 */
export function bucketIndexOf(buckets: readonly StatsBucket[], timeMs: number): number {
  if (buckets.length === 0 || Number.isNaN(timeMs)) return -1;

  let lo = 0;
  let hi = buckets.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (buckets[mid]!.startMs <= timeMs) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (candidate === -1) return -1;
  return timeMs < buckets[candidate]!.endMs ? candidate : -1;
}

/**
 * Distributes `items` into one array per bucket, preserving input order within
 * each bucket. Items outside every bucket are dropped.
 */
export function groupIntoBuckets<T>(
  items: readonly T[],
  buckets: readonly StatsBucket[],
  timeOf: (item: T) => number,
): T[][] {
  const grouped: T[][] = buckets.map(() => []);
  for (const item of items) {
    const idx = bucketIndexOf(buckets, timeOf(item));
    if (idx !== -1) grouped[idx]!.push(item);
  }
  return grouped;
}
