import type { Migration, MigrationContext } from '../types.js';
import { perRunUsage, isUsableBaseline, type SdkUsageTotals } from '../../../application/utils/sdk-run-usage.js';

/**
 * Per-run SDK cost instead of per-session cost.
 *
 * The SDK's `total_cost_usd` / `modelUsage` are session totals that a resumed
 * session carries over from its transcript. Fleex stored them as the run's
 * cost, so each mention on a ticket re-billed the whole session history and
 * every Σ over executions (ticket badge, statistics, focus) was inflated.
 *
 * 1. `sdk_total_*` keep the raw session totals at the end of each run — the
 *    baseline the next resumed run is measured against.
 * 2. Backfill: for every SDK session, the existing values become the raw
 *    totals, and `cost_usd` / token columns are rewritten to each run's share
 *    using the exact rule applied at runtime (`perRunUsage`).
 *
 * CLI executions (`source = 'cli'`) are computed from the transcript per
 * session already and are left untouched.
 */
const COLUMNS: [string, string][] = [
  ['sdk_total_cost_usd', 'REAL'],
  ['sdk_total_input_tokens', 'INTEGER'],
  ['sdk_total_output_tokens', 'INTEGER'],
  ['sdk_total_cache_read_tokens', 'INTEGER'],
  ['sdk_total_cache_creation_tokens', 'INTEGER'],
];

const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v));
const lit = (v: number | undefined): string => (v == null || !Number.isFinite(v) ? 'NULL' : String(v));

export async function backfillPerRunUsage(ctx: MigrationContext): Promise<void> {
  const rows = await ctx.query(
    `SELECT execution_id, sdk_session_id, cost_usd, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens
     FROM agent_event_executions
     WHERE sdk_session_id IS NOT NULL AND cost_usd IS NOT NULL
       AND (source IS NULL OR source <> 'cli')
     ORDER BY sdk_session_id, started_at`,
  );

  let session: unknown = undefined;
  let baseline: SdkUsageTotals | null = null;
  for (const row of rows) {
    if (row['sdk_session_id'] !== session) {
      session = row['sdk_session_id'];
      baseline = null;
    }
    const totals: SdkUsageTotals = {
      costUsd: num(row['cost_usd']),
      inputTokens: num(row['input_tokens']),
      outputTokens: num(row['output_tokens']),
      cacheReadTokens: num(row['cache_read_tokens']),
      cacheCreationTokens: num(row['cache_creation_tokens']),
    };
    const run = perRunUsage(totals, baseline);
    if (isUsableBaseline(totals)) baseline = totals;

    const id = String(row['execution_id']).replace(/'/g, "''");
    await ctx.exec(
      `UPDATE agent_event_executions SET
         sdk_total_cost_usd = ${lit(totals.costUsd)},
         sdk_total_input_tokens = ${lit(totals.inputTokens)},
         sdk_total_output_tokens = ${lit(totals.outputTokens)},
         sdk_total_cache_read_tokens = ${lit(totals.cacheReadTokens)},
         sdk_total_cache_creation_tokens = ${lit(totals.cacheCreationTokens)},
         cost_usd = ${lit(run.costUsd)},
         input_tokens = ${lit(run.inputTokens)},
         output_tokens = ${lit(run.outputTokens)},
         cache_read_tokens = ${lit(run.cacheReadTokens)},
         cache_creation_tokens = ${lit(run.cacheCreationTokens)}
       WHERE execution_id = '${id}'`,
    );
  }
}

const migration: Migration = {
  name: '035_execution_sdk_session_totals',

  async up(ctx) {
    for (const [col, type] of COLUMNS) {
      await ctx.exec(`ALTER TABLE agent_event_executions ADD COLUMN ${col} ${type}`);
    }
    await backfillPerRunUsage(ctx);

    if (ctx.adapter === 'supabase') {
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    // Per-run values are kept: they are the correct ones. The raw totals go.
    if (ctx.adapter === 'sqlite') return;
    for (const [col] of COLUMNS) {
      await ctx.exec(`ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS ${col}`);
    }
  },
};

export default migration;
