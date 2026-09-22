import type { Migration } from '../types.js';

/**
 * Consecutive failure counter on assistant threads, so the assistant can retry a
 * crashed agent run a bounded number of times before involving the user.
 * Additive and idempotent (nullable-with-default column).
 */
const migration: Migration = {
  name: '036_agent_thread_failures',

  async up(ctx) {
    try {
      await ctx.exec('ALTER TABLE agent_threads ADD COLUMN failures INTEGER NOT NULL DEFAULT 0');
    } catch {
      // Column already exists.
    }
    if (ctx.adapter === 'supabase') await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
  },

  async down(ctx) {
    if (ctx.adapter === 'sqlite') return;
    await ctx.exec('ALTER TABLE agent_threads DROP COLUMN IF EXISTS failures');
  },
};

export default migration;
