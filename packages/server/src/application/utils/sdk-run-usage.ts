/**
 * Usage counters as the SDK reports them on a `result` message.
 *
 * These are SESSION totals, not per-run figures: a resumed session "continues
 * from the total its transcript saved, so the first result already carries the
 * earlier turns" (claude-agent-sdk, `SDKResultMessage.total_cost_usd` /
 * `modelUsage`). Every mention on a ticket resumes the persona's session, so
 * storing these raw made each run carry the whole history and every Σ over
 * executions (ticket badge, statistics, focus) grow quadratically.
 */
export interface SdkUsageTotals {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

const FIELDS = ['costUsd', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'] as const;

/**
 * What THIS run consumed: the session totals minus the totals recorded at the
 * end of the previous run of the same SDK session (`baseline`).
 *
 * With no baseline (fresh session) the totals ARE the run. When any counter
 * went backwards the session restarted its count (transcript without a saved
 * total, or a `/clear`), so the totals again describe only this run — taken
 * whole rather than producing a negative or partial delta.
 */
export function perRunUsage(totals: SdkUsageTotals, baseline: SdkUsageTotals | null): SdkUsageTotals {
  if (!baseline) return { ...totals };
  const restarted = FIELDS.some((f) => totals[f] != null && totals[f]! < (baseline[f] ?? 0));
  if (restarted) return { ...totals };
  const run: SdkUsageTotals = {};
  for (const f of FIELDS) {
    if (totals[f] != null) run[f] = totals[f]! - (baseline[f] ?? 0);
  }
  return run;
}

/**
 * A totals snapshot is a usable baseline only if it saw spend: a crashed run's
 * result "may carry zeroed values", and treating that zero as the session's
 * running total would bill the next run for the whole history again.
 */
export function isUsableBaseline(t: SdkUsageTotals | null | undefined): t is SdkUsageTotals {
  return t?.costUsd != null && t.costUsd > 0;
}
