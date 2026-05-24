import type { Migration } from '../types.js';

/**
 * Fix workflow_templates.enabled column type on pgsql/supabase.
 *
 * Migration 017 was initially shipped with `enabled INTEGER` for all dialects,
 * then fixed in a later commit to use BOOLEAN on pgsql/supabase. The fix
 * relies on `CREATE TABLE IF NOT EXISTS`, so instances that ran the original
 * 017 keep the broken INTEGER column and reject boolean inserts.
 *
 * This migration ALTERs the column type. SQLite keeps INTEGER (no change).
 */
const migration: Migration = {
  name: '018_fix_workflow_templates_enabled_type',

  async up(ctx) {
    if (ctx.adapter === 'json' || ctx.adapter === 'sqlite') return;

    // pgsql / supabase: convert INTEGER → BOOLEAN (1 → true, 0 → false)
    await ctx.exec(`
      ALTER TABLE workflow_templates
        ALTER COLUMN enabled DROP DEFAULT,
        ALTER COLUMN enabled TYPE BOOLEAN USING (enabled::int <> 0),
        ALTER COLUMN enabled SET DEFAULT TRUE
    `);
  },

  async down(ctx) {
    if (ctx.adapter === 'json' || ctx.adapter === 'sqlite') return;
    await ctx.exec(`
      ALTER TABLE workflow_templates
        ALTER COLUMN enabled DROP DEFAULT,
        ALTER COLUMN enabled TYPE INTEGER USING (CASE WHEN enabled THEN 1 ELSE 0 END),
        ALTER COLUMN enabled SET DEFAULT 1
    `);
  },
};

export default migration;
