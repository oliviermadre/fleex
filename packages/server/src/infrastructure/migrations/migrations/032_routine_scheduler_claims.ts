import type { Migration } from '../types.js';

/**
 * Makes a scheduled occurrence claimable, so that several Fleex instances
 * sharing one storage (two laptops on the same Supabase, or `~/.fleex/repo`
 * plus a QA worktree on the same `fleex.db`) cannot launch the same routine
 * twice.
 *
 * The claim itself needs no new state — it is a compare-and-swap on the
 * existing `next_run_at`, which is exactly the column that says "this
 * occurrence has not been taken yet". What these two columns add is the
 * *answer to "who took it"*: without them a run that happened on the other
 * machine is indistinguishable from one that never fired, which is the first
 * question anyone asks when a routine misbehaves in a multi-instance setup.
 *
 * Both are nullable with no default: a routine that has never been claimed by
 * a scheduler (manual-only, or created before this migration) genuinely has no
 * claimant, and writing a fake one would make the column lie.
 */
const migration: Migration = {
  name: '032_routine_scheduler_claims',

  async up(ctx) {
    const tsType = ctx.dialect({ sqlite: 'TEXT', pgsql: 'TIMESTAMPTZ', supabase: 'TIMESTAMPTZ' });

    for (const col of [`last_claimed_by TEXT`, `last_claimed_at ${tsType}`]) {
      try {
        await ctx.exec(`ALTER TABLE routines ADD COLUMN ${col}`);
      } catch {
        // Column already exists (idempotent re-run).
      }
    }

    // PostgREST caches the schema; without this the very first claim would 400
    // on an unknown column rather than simply losing the race.
    if (ctx.adapter === 'supabase') {
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    if (ctx.adapter !== 'sqlite') {
      await ctx.exec('ALTER TABLE routines DROP COLUMN IF EXISTS last_claimed_by');
      await ctx.exec('ALTER TABLE routines DROP COLUMN IF EXISTS last_claimed_at');
      if (ctx.adapter === 'supabase') await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
    // SQLite: left in place. Dropping them would mean the full table rebuild
    // migration 025 documents, and an unread nullable column is inert.
  },
};

export default migration;
