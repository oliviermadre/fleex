import { DEFAULT_STATUS_MODEL } from '@fleex/shared';
import type { Migration } from '../types.js';

/**
 * Add the `color` column to status_columns (presentation palette name) and
 * backfill the built-in columns from DEFAULT_STATUS_MODEL. Separate from 021
 * because 021 is already committed (never edit a shipped migration).
 */
const migration: Migration = {
  name: '022_add_status_column_color',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    await ctx.exec(`ALTER TABLE status_columns ADD COLUMN color TEXT NOT NULL DEFAULT 'gray'`);

    const text = (v: string) => `'${v.replace(/'/g, "''")}'`;
    for (const c of DEFAULT_STATUS_MODEL.columns) {
      await ctx.exec(
        `UPDATE status_columns SET color = ${text(c.color)} WHERE key = ${text(c.key)}`,
      );
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    // SQLite < 3.35 cannot DROP COLUMN; best-effort for pg/supabase.
    if (ctx.adapter === 'sqlite') return;
    await ctx.exec('ALTER TABLE status_columns DROP COLUMN color');
  },
};

export default migration;
