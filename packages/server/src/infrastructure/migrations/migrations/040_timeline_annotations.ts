import type { Migration } from '../types.js';

/**
 * Timeline annotations: a highlighted piece of information pinned to an instant
 * of a ticket's Timeline (title always shown, optional markdown body, a tone).
 *
 * - Deleting a ticket deletes its annotations (FK cascade).
 * - `source_comment_id` links an annotation promoted from a comment. Deleting
 *   that comment keeps the annotation and nulls the link — done in application
 *   code on every dialect (AnnotationStorePort.clearSourceComment). SQLite gets
 *   no FK on it on purpose: its comment store saves with INSERT OR REPLACE,
 *   which deletes the row first and would null the link on every comment edit.
 */
const migration: Migration = {
  name: '040_timeline_annotations',

  async up(ctx) {
    const tableSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS timeline_annotations (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        tone TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'highlight', 'warning', 'success')),
        source_comment_id TEXT,
        author_type TEXT NOT NULL,
        author_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS timeline_annotations (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        at TIMESTAMPTZ NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        tone TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'highlight', 'warning', 'success')),
        source_comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL,
        author_type TEXT NOT NULL,
        author_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS timeline_annotations (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        at TIMESTAMPTZ NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        tone TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'highlight', 'warning', 'success')),
        source_comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL,
        author_type TEXT NOT NULL,
        author_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (tableSql) await ctx.exec(tableSql);

    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_timeline_annotations_ticket_at ON timeline_annotations(ticket_id, at)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_timeline_annotations_source_comment ON timeline_annotations(source_comment_id)');

    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE timeline_annotations ENABLE ROW LEVEL SECURITY');
      await ctx.exec(
        `CREATE POLICY "service_role_timeline_annotations" ON timeline_annotations FOR ALL USING (true) WITH CHECK (true)`,
      );
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS timeline_annotations');
  },
};

export default migration;
