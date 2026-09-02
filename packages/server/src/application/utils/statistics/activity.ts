/** Activity heatmap (C4) and usage-by-type trend (C13). */
import type { ActivityHeatmapCell, UsageByTypeBucket } from '@fleex/shared';
import type { StatsSlice } from './slice.js';
import type { ExecutionRow } from './rows.js';

/**
 * Every agent/skill run laid out as weekday × hour, in the *client's* local
 * time.
 *
 * The absolute instant is shifted by the client's `getTimezoneOffset()` and then
 * read with UTC getters, so the result does not depend on the server's own
 * timezone — reading local getters here would double-shift on a non-UTC host.
 */
export function computeActivityHeatmap(
  executions: readonly ExecutionRow[],
  tzOffsetMinutes: number,
): ActivityHeatmapCell[] {
  const tzShiftMs = tzOffsetMinutes * 60_000;
  const counts = new Map<string, number>();

  for (const e of executions) {
    if (Number.isNaN(e.startedAtMs)) continue;
    const local = new Date(e.startedAtMs - tzShiftMs);
    const key = `${local.getUTCDay()}:${local.getUTCHours()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()].map(([key, count]) => {
    const [dow, hour] = key.split(':').map(Number) as [number, number];
    return { dow, hour, count };
  });
}

/** Per-bucket split of the four execution modes. */
export function computeUsageByType(slice: StatsSlice): UsageByTypeBucket[] {
  return slice.buckets.map((bucket, i) => {
    const bExecutions = slice.executionsByBucket[i]!;
    return {
      date: bucket.label,
      agents: bExecutions.filter((e) => !e.isSkill).length,
      skills: bExecutions.filter((e) => e.isSkill).length,
      panels: slice.panelEventsByBucket[i]!.length,
      workflows: slice.workflowRunsByBucket[i]!.length,
    };
  });
}
