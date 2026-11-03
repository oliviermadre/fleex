import type { Migration } from '../types.js';

/**
 * Ticket complexity: a Fibonacci-like point estimate (`0`, `0.5`, … `55`, `inf`).
 * Stored as TEXT (a closed string union, like `priority`); validated by the API
 * and normalised on read, so no CHECK constraint.
 *
 * Non-destructive: one nullable column, no default — existing tickets are
 * "not estimated" (`null`), which is deliberately distinct from `'0'`.
 */
const migration: Migration = {
  name: '043_ticket_complexity',

  async up(ctx) {
    if (ctx.adapter === 'sqlite') {
      // SQLite has no ADD COLUMN IF NOT EXISTS; a failure means it already exists.
      try {
        await ctx.exec(`ALTER TABLE tickets ADD COLUMN complexity TEXT`);
      } catch { /* re-run after a partial apply */ }
    } else {
      // pg: a failed statement would abort the surrounding transaction — never fail.
      await ctx.exec(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS complexity TEXT`);
    }
    // The Supabase adapter writes `complexity` on every ticket insert/upsert through
    // PostgREST: a stale schema cache would fail them all (PGRST204).
    if (ctx.adapter === 'supabase') {
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety.
    if (ctx.adapter === 'sqlite') return;
    await ctx.exec(`ALTER TABLE tickets DROP COLUMN IF EXISTS complexity`);
  },
};

export default migration;
