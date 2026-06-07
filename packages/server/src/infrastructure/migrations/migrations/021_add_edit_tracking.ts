import type { Migration } from '../types.js';

/**
 * Adds edit-tracking columns to `comments` and `deliverables` so the UI can
 * materialize that content was edited (badge + editor + date) independently of
 * the generic `updated_at` technical timestamp.
 *
 * - comments.last_edited_at / last_edited_by / edit_count
 * - deliverables.last_edited_at / last_edited_by  (version already exists)
 *
 * All columns are nullable (or default 0) so existing rows are unaffected.
 */
const migration: Migration = {
  name: '021_add_edit_tracking',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const timestampType = ctx.dialect({
      sqlite: 'TEXT',
      pgsql: 'TIMESTAMPTZ',
      supabase: 'TIMESTAMPTZ',
      json: null,
    });

    const cols: string[] = [
      `ALTER TABLE comments ADD COLUMN last_edited_at ${timestampType}`,
      `ALTER TABLE comments ADD COLUMN last_edited_by TEXT`,
      `ALTER TABLE comments ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE deliverables ADD COLUMN last_edited_at ${timestampType}`,
      `ALTER TABLE deliverables ADD COLUMN last_edited_by TEXT`,
    ];

    for (const sql of cols) {
      try {
        await ctx.exec(sql);
      } catch {
        // Column may already exist — ALTER ... ADD COLUMN is not idempotent on
        // every dialect, so swallow the duplicate-column error.
      }
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    // SQLite lacks reliable DROP COLUMN on older versions; skip there for safety.
    if (ctx.adapter === 'sqlite') return;
    const drops = [
      'ALTER TABLE comments DROP COLUMN IF EXISTS last_edited_at',
      'ALTER TABLE comments DROP COLUMN IF EXISTS last_edited_by',
      'ALTER TABLE comments DROP COLUMN IF EXISTS edit_count',
      'ALTER TABLE deliverables DROP COLUMN IF EXISTS last_edited_at',
      'ALTER TABLE deliverables DROP COLUMN IF EXISTS last_edited_by',
    ];
    for (const sql of drops) await ctx.exec(sql);
  },
};

export default migration;
