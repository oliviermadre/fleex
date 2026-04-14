import type { Migration } from '../types.js';

const migration: Migration = {
  name: '013_add_ticket_type',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const addCol = ctx.dialect({
      sqlite: `ALTER TABLE tickets ADD COLUMN type TEXT`,
      pgsql: `ALTER TABLE tickets ADD COLUMN type TEXT`,
      supabase: `ALTER TABLE tickets ADD COLUMN type TEXT`,
      json: null,
    });
    if (addCol) {
      try {
        await ctx.exec(addCol);
      } catch {
        // Column may already exist
      }
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety
    if (ctx.adapter !== 'sqlite') {
      await ctx.exec('ALTER TABLE tickets DROP COLUMN IF EXISTS type');
    }
  },
};

export default migration;
