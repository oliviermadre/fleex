import type { Migration } from '../types.js';

/**
 * Per-execution audit of the *resolved* effort and fast-mode that actually ran,
 * alongside the existing `model` / `effective_mode` columns (migrations 006/007).
 * Needed for cost tracking & the audit trail: "which model + effort + fast ran
 * on which execution".
 *
 * Non-destructive: two nullable columns on agent_event_executions. The JSON
 * adapter stores these on its index entry and needs no schema change.
 */
const migration: Migration = {
  name: '022_add_execution_effort_and_fast',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const cols: { sqlite: string; pgsql: string; supabase: string }[] = [
      {
        sqlite: `ALTER TABLE agent_event_executions ADD COLUMN effort TEXT`,
        pgsql: `ALTER TABLE agent_event_executions ADD COLUMN effort TEXT`,
        supabase: `ALTER TABLE agent_event_executions ADD COLUMN effort TEXT`,
      },
      {
        sqlite: `ALTER TABLE agent_event_executions ADD COLUMN fast_mode INTEGER`,
        pgsql: `ALTER TABLE agent_event_executions ADD COLUMN fast_mode BOOLEAN`,
        supabase: `ALTER TABLE agent_event_executions ADD COLUMN fast_mode BOOLEAN`,
      },
    ];

    for (const col of cols) {
      const stmt = ctx.dialect({ ...col, json: null });
      if (!stmt) continue;
      try {
        await ctx.exec(stmt);
      } catch {
        // Column may already exist (idempotent re-run).
      }
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety.
    if (ctx.adapter === 'sqlite') return;
    for (const name of ['effort', 'fast_mode']) {
      await ctx.exec(`ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS ${name}`);
    }
  },
};

export default migration;
