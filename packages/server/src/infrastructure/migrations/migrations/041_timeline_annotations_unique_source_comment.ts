import type { Migration } from '../types.js';

/**
 * A comment can be pinned to the Timeline only once (AC8). The use-case checks
 * it before saving, but two concurrent pins (double click, a human and an agent)
 * would both pass that read. A partial UNIQUE index makes the database the
 * arbiter; the losing save is mapped back to CommentAlreadyAnnotatedError (409).
 *
 * Partial on `source_comment_id IS NOT NULL`: free annotations have no source
 * and must not collide with each other. Replaces the plain lookup index of 040.
 */
const migration: Migration = {
  name: '041_timeline_annotations_unique_source_comment',

  async up(ctx) {
    await ctx.exec('DROP INDEX IF EXISTS idx_timeline_annotations_source_comment');
    await ctx.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_annotations_source_comment_unique ON timeline_annotations (source_comment_id) WHERE source_comment_id IS NOT NULL',
    );
  },

  async down(ctx) {
    await ctx.exec('DROP INDEX IF EXISTS idx_timeline_annotations_source_comment_unique');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_timeline_annotations_source_comment ON timeline_annotations(source_comment_id)');
  },
};

export default migration;
