import { isUsableBaseline, type SdkSessionBaseline, type SdkUsageTotals } from '../../application/utils/sdk-run-usage.js';

type Row = Record<string, number | string | null | undefined>;

/**
 * Map the `sdk_total_*` columns of an `agent_event_executions` row. Values are
 * coerced with Number() because pg hands BIGINT/NUMERIC back as strings.
 */
export function sdkTotalsFromRow(row: Row): SdkUsageTotals {
  const num = (v: number | string | null | undefined) => (v == null ? undefined : Number(v));
  return {
    costUsd: num(row['sdk_total_cost_usd']),
    inputTokens: num(row['sdk_total_input_tokens']),
    outputTokens: num(row['sdk_total_output_tokens']),
    cacheReadTokens: num(row['sdk_total_cache_read_tokens']),
    cacheCreationTokens: num(row['sdk_total_cache_creation_tokens']),
  };
}

/**
 * Earlier runs of a session, newest first → baseline. The baseline must be the
 * IMMEDIATELY previous run that spent something: if that run has no raw totals
 * (legacy row), there is no baseline — reaching further back would subtract too
 * little. Runs with no spend at all (crash before any result) are skipped.
 */
export function sdkBaselineFromRows(rows: Row[]): SdkSessionBaseline {
  for (const row of rows) {
    const totals = sdkTotalsFromRow(row);
    if (isUsableBaseline(totals)) {
      const v = row['cli_version'];
      return { priorRuns: rows.length, latest: { totals, cliVersion: typeof v === 'string' ? v : null } };
    }
    const cost = row['cost_usd'];
    if (cost != null && Number(cost) > 0) break; // spent, but no raw totals recorded
  }
  return { priorRuns: rows.length, latest: null };
}
