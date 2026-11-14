import type { Migration } from '../types.js';

/**
 * Ticket naming, fixed at creation. A ticket's folder is `<displayId>-<slug>`
 * and its branch `fleex/<displayId>-<slug>`, where `slug` is its title at
 * creation, locked: a rename moves neither.
 *
 * - `slug`: stored at creation. NULL for rows created before this migration;
 *   the boot backfill (`BackfillTicketNamingUseCase`) locks them.
 * - `workspace_dir` / `branch_name`: set only by that backfill, for a ticket
 *   that already had a folder (`<id6>-<slug>`) or a branch (`ticket/…`,
 *   `agent/…`) — they keep it, nothing on disk or in git is ever renamed.
 *
 * Non-destructive and idempotent: three nullable columns, no SQL backfill (the
 * folders it needs are on disk, out of SQL's sight). Named `045_ticket_naming`,
 * not the unmerged `045_ticket_slug`, so an instance that applied the latter
 * still runs it.
 */
const COLUMNS = ['slug', 'workspace_dir', 'branch_name'] as const;

const migration: Migration = {
  name: '045_ticket_naming',

  async up(ctx) {
    for (const column of COLUMNS) {
      if (ctx.adapter === 'sqlite') {
        // SQLite has no ADD COLUMN IF NOT EXISTS; a failure means it already exists.
        try {
          await ctx.exec(`ALTER TABLE tickets ADD COLUMN ${column} TEXT`);
        } catch { /* re-run after a partial apply */ }
      } else {
        // pg: a failed statement would abort the surrounding transaction — never fail.
        await ctx.exec(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ${column} TEXT`);
      }
    }
    // The Supabase adapter writes these columns on every ticket insert/upsert
    // through PostgREST: a stale schema cache would fail them all (PGRST204).
    if (ctx.adapter === 'supabase') {
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety.
    if (ctx.adapter === 'sqlite') return;
    for (const column of COLUMNS) {
      await ctx.exec(`ALTER TABLE tickets DROP COLUMN IF EXISTS ${column}`);
    }
  },
};

export default migration;
