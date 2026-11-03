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
    const stmt = ctx.dialect({
      sqlite: `ALTER TABLE tickets ADD COLUMN complexity TEXT`,
      pgsql: `ALTER TABLE tickets ADD COLUMN complexity TEXT`,
      supabase: `ALTER TABLE tickets ADD COLUMN complexity TEXT`,
    });
    if (!stmt) return;
    try {
      await ctx.exec(stmt);
    } catch {
      // Column may already exist (idempotent re-run).
    }
  },

  async down(ctx) {
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety.
    if (ctx.adapter === 'sqlite') return;
    await ctx.exec(`ALTER TABLE tickets DROP COLUMN IF EXISTS complexity`);
  },
};

export default migration;
