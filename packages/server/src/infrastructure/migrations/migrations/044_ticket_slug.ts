import type { Migration } from '../types.js';

/**
 * Ticket slug: the title at creation, slugified, then locked. The workspace
 * folder and the git branch derive from it, so a rename moves neither.
 *
 * Non-destructive: one nullable column, no SQL backfill. A NULL row derives its
 * slug from its title and locks it on its next save; a ticket already renamed
 * before this migration is backfilled at boot from its workspace folder on disk
 * (`BackfillTicketSlugsUseCase`), which SQL cannot see.
 */
const migration: Migration = {
  name: '044_ticket_slug',

  async up(ctx) {
    if (ctx.adapter === 'sqlite') {
      // SQLite has no ADD COLUMN IF NOT EXISTS; a failure means it already exists.
      try {
        await ctx.exec(`ALTER TABLE tickets ADD COLUMN slug TEXT`);
      } catch { /* re-run after a partial apply */ }
    } else {
      // pg: a failed statement would abort the surrounding transaction — never fail.
      await ctx.exec(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS slug TEXT`);
    }
    // The Supabase adapter writes `slug` on every ticket insert/upsert through
    // PostgREST: a stale schema cache would fail them all (PGRST204).
    if (ctx.adapter === 'supabase') {
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety.
    if (ctx.adapter === 'sqlite') return;
    await ctx.exec(`ALTER TABLE tickets DROP COLUMN IF EXISTS slug`);
  },
};

export default migration;
