import type { Migration } from '../types.js';

/**
 * Closed questions an agent declares alongside a `waiting_for_info` comment
 * (AgentQuestion[]). The UI renders one button per option from this column
 * instead of guessing options out of the markdown body. NULL = free reply only,
 * which is what every pre-existing comment reads as.
 *
 * A column on an existing table: no new RLS policy needed on Supabase.
 */
const migration: Migration = {
  name: '035_comment_questions',

  async up(ctx) {
    const sql = ctx.dialect({
      sqlite: `ALTER TABLE comments ADD COLUMN questions TEXT`,
      pgsql: `ALTER TABLE comments ADD COLUMN IF NOT EXISTS questions JSONB`,
      supabase: `ALTER TABLE comments ADD COLUMN IF NOT EXISTS questions JSONB`,
    });
    if (sql) await ctx.exec(sql);
  },

  async down(ctx) {
    const sql = ctx.dialect({
      sqlite: `ALTER TABLE comments DROP COLUMN questions`,
      pgsql: `ALTER TABLE comments DROP COLUMN IF EXISTS questions`,
      supabase: `ALTER TABLE comments DROP COLUMN IF EXISTS questions`,
    });
    if (sql) {
      try {
        await ctx.exec(sql);
      } catch {
        // SQLite < 3.35 doesn't support DROP COLUMN — a harmless legacy column remains.
      }
    }
  },
};

export default migration;
