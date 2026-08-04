import type { Migration } from '../types.js';

const migration: Migration = {
  name: '014_add_ticket_first_doing_at',

  async up(ctx) {

    const addCol = ctx.dialect({
      sqlite: `ALTER TABLE tickets ADD COLUMN first_doing_at TEXT`,
      pgsql: `ALTER TABLE tickets ADD COLUMN first_doing_at TIMESTAMPTZ`,
      supabase: `ALTER TABLE tickets ADD COLUMN first_doing_at TIMESTAMPTZ`,
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
    if (ctx.adapter !== 'sqlite') {
      await ctx.exec('ALTER TABLE tickets DROP COLUMN IF EXISTS first_doing_at');
    }
  },
};

export default migration;
