import type { SdkUsageTotals } from '../../application/utils/sdk-run-usage.js';

/**
 * Map the `sdk_total_*` columns of an `agent_event_executions` row. Values are
 * coerced with Number() because pg hands BIGINT/NUMERIC back as strings.
 */
export function sdkTotalsFromRow(row: Record<string, number | string | null | undefined>): SdkUsageTotals {
  const num = (v: number | string | null | undefined) => (v == null ? undefined : Number(v));
  return {
    costUsd: num(row['sdk_total_cost_usd']),
    inputTokens: num(row['sdk_total_input_tokens']),
    outputTokens: num(row['sdk_total_output_tokens']),
    cacheReadTokens: num(row['sdk_total_cache_read_tokens']),
    cacheCreationTokens: num(row['sdk_total_cache_creation_tokens']),
  };
}
