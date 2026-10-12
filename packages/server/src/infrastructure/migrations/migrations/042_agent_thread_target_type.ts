import type { Migration } from '../types.js';

/**
 * Assistant threads can delegate to a skill, a panel or a workflow, not only to
 * a persona: `target_type` says which. Existing rows are persona threads.
 * Additive and idempotent (a column with a default on an existing table: no new
 * RLS policy on Supabase).
 */
const migration: Migration = {
  name: '042_agent_thread_target_type',

  async up(ctx) {
    try {
      await ctx.exec(`ALTER TABLE agent_threads ADD COLUMN target_type TEXT NOT NULL DEFAULT 'agent'`);
    } catch {
      // Column already exists.
    }
    if (ctx.adapter === 'supabase') await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
  },

  async down(ctx) {
    if (ctx.adapter === 'sqlite') return;
    await ctx.exec('ALTER TABLE agent_threads DROP COLUMN IF EXISTS target_type');
  },
};

export default migration;
