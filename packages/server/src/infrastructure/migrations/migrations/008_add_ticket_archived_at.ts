import type { Migration } from '../types.js';

const migration: Migration = {
  name: '008_add_ticket_archived_at',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const addCol = ctx.dialect({
      sqlite: `ALTER TABLE tickets ADD COLUMN archived_at TEXT`,
      pgsql: `ALTER TABLE tickets ADD COLUMN archived_at TIMESTAMPTZ`,
      supabase: `ALTER TABLE tickets ADD COLUMN archived_at TIMESTAMPTZ`,
      json: null,
    });
    if (addCol) {
      try {
        await ctx.exec(addCol);
      } catch {
        // Column may already exist
      }
    }

    const addIdx = 'CREATE INDEX IF NOT EXISTS idx_tickets_archived_at ON tickets(archived_at)';
    await ctx.exec(addIdx);
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    await ctx.exec('DROP INDEX IF EXISTS idx_tickets_archived_at');
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety
    if (ctx.adapter !== 'sqlite') {
      await ctx.exec('ALTER TABLE tickets DROP COLUMN IF EXISTS archived_at');
    }
  },
};

export default migration;
