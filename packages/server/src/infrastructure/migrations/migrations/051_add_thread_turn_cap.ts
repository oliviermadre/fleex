import type { Migration } from '../types.js';

/**
 * `agent_threads.turn_cap`: JSON `{ base, askedAt }` — the runaway guard of a
 * thread. At the cap of assistant turns the thread is no longer concluded: the
 * human is asked once (« Continuer » / « Conclure »). `askedAt` remembers that
 * the question is pending, so it is not asked again on every later attempt;
 * `base` is the number of turns already sent when the human said « Continuer »,
 * from which the count restarts.
 *
 * Additive and idempotent. NULL reads as "never reached the cap".
 */
const migration: Migration = {
  name: '051_add_thread_turn_cap',

  async up(ctx) {
    if (ctx.adapter === 'sqlite') {
      try {
        await ctx.exec('ALTER TABLE agent_threads ADD COLUMN turn_cap TEXT');
      } catch {
        /* re-run after partial apply */
      }
    } else {
      await ctx.exec('ALTER TABLE IF EXISTS agent_threads ADD COLUMN IF NOT EXISTS turn_cap TEXT');
    }

    if (ctx.adapter === 'supabase') {
      await ctx.exec('NOTIFY pgrst, \'reload schema\'');
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'sqlite') return; // older SQLite has no DROP COLUMN
    await ctx.exec('ALTER TABLE IF EXISTS agent_threads DROP COLUMN IF EXISTS turn_cap');
  },
};

export default migration;
