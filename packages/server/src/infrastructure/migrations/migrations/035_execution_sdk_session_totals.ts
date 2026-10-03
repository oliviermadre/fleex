import type { Migration } from '../types.js';

/**
 * Columns to meter SDK runs per run instead of per session.
 *
 * Since Claude Code CLI 2.1.284 the SDK's `total_cost_usd` / `modelUsage` are
 * session totals carried over a resume, so storing them as the run's cost
 * re-billed the whole session history on every mention. Runtime now stores the
 * run's share and keeps the raw SDK values next to it:
 *
 * - `sdk_total_*`  raw usage the SDK reported (the next resume's baseline)
 * - `cli_version`  CLI that produced the run — decides how its usage reads
 * - `cost_basis`   'per_run' | 'per_run:backfill' | 'unverified' (NULL = legacy)
 *
 * Schema only, on purpose: historical rows are NOT rewritten here. Runs from
 * CLIs ≤ 2.1.270 were already per-run (verified against transcripts), so a blind
 * rewrite would corrupt them. History is corrected by the evidence-driven,
 * dry-run-by-default `scripts/fix-sdk-session-costs.ts`.
 */
const COLUMNS: [string, string][] = [
  ['sdk_total_cost_usd', 'REAL'],
  ['sdk_total_input_tokens', 'INTEGER'],
  ['sdk_total_output_tokens', 'INTEGER'],
  ['sdk_total_cache_read_tokens', 'INTEGER'],
  ['sdk_total_cache_creation_tokens', 'INTEGER'],
  ['cli_version', 'TEXT'],
  ['cost_basis', 'TEXT'],
];

const migration: Migration = {
  name: '035_execution_sdk_session_totals',

  async up(ctx) {
    for (const [col, type] of COLUMNS) {
      if (ctx.adapter === 'sqlite') {
        // SQLite has no ADD COLUMN IF NOT EXISTS; a failure means it already exists.
        try {
          await ctx.exec(`ALTER TABLE agent_event_executions ADD COLUMN ${col} ${type}`);
        } catch { /* re-run after a partial apply */ }
      } else {
        // pg: a failed statement would abort the surrounding transaction — never fail.
        await ctx.exec(`ALTER TABLE agent_event_executions ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      }
    }
    if (ctx.adapter === 'supabase') {
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'sqlite') return; // older SQLite has no DROP COLUMN
    for (const [col] of COLUMNS) {
      await ctx.exec(`ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS ${col}`);
    }
  },
};

export default migration;
