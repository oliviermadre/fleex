import type { Migration } from '../types.js';

/**
 * Partial index for the memory sweeper's backlog query.
 *
 * Every instance runs `listPendingEmbeddings` once a minute:
 * `WHERE embedding IS NULL ORDER BY created_at LIMIT n`. No index could serve
 * it, so each poll seq-scanned the whole of `memory_chunks` (155 MB, embeddings
 * included) to return, almost always, zero rows — 932 ms per call, 47k calls,
 * the single largest consumer of database time. Besides its own cost, each scan
 * evicted the shared buffers every other query relied on, which is what pushed
 * cheap reads (event log, deliverables) past the `anon` role's 3 s
 * statement_timeout on the Stats view.
 *
 * Partial on `embedding IS NULL`, so it stays tiny (the backlog is normally
 * empty) and ordered on `created_at` like the query. Measured: 932 ms → 2 ms.
 */
const migration: Migration = {
  name: '039_memory_chunks_pending_index',

  async up(ctx) {
    await ctx.exec(
      'CREATE INDEX IF NOT EXISTS idx_memory_chunks_pending ON memory_chunks (created_at) WHERE embedding IS NULL',
    );
  },

  async down(ctx) {
    await ctx.exec('DROP INDEX IF EXISTS idx_memory_chunks_pending');
  },
};

export default migration;
