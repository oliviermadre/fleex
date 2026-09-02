import type { Migration } from '../types.js';
import {
  EMBEDDING_INDEX_SQL,
  MATCH_FUNCTION_SQL,
} from '../../adapters/supabase/memory-vector-sql.js';

/**
 * Server-side vector search for the Supabase driver.
 *
 * PostgREST cannot express a nearest-neighbour query, and scoring client-side
 * would mean shipping the whole index over the network to rank eight results. So
 * the comparison lives in a SQL function the adapter calls by RPC, and only the
 * winners cross the wire.
 *
 * SQLite and plain pgsql skip this entirely: they score in process, where a full
 * scan of a single-user corpus costs a few milliseconds.
 *
 * Everything is guarded and idempotent. A managed Postgres may forbid
 * `CREATE EXTENSION`, and a Supabase project without pgvector must still boot —
 * the adapter reports semantic search as unavailable and retrieval falls back to
 * the legacy ranking, which is a degraded feature rather than a broken instance.
 */
const migration: Migration = {
  name: '034_memory_pgvector_search',

  async up(ctx) {
    if (ctx.adapter !== 'supabase') return;

    try {
      await ctx.exec('CREATE EXTENSION IF NOT EXISTS vector');
    } catch {
      // Not installable here. Migration 033 already left `embedding` nullable, so
      // the table is usable for keyword search; the function below would fail, so
      // stop rather than leave a half-built search path.
      return;
    }

    // The statements themselves live beside the adapter that depends on them, so
    // the boot-time repair path applies exactly the same SQL as this migration
    // instead of a second copy that could drift from it.
    await ctx.exec(EMBEDDING_INDEX_SQL);
    await ctx.exec(MATCH_FUNCTION_SQL);
  },

  async down(ctx) {
    if (ctx.adapter !== 'supabase') return;
    await ctx.exec('DROP FUNCTION IF EXISTS match_memory_chunks(vector, int, text[], text, text, text)');
    await ctx.exec('DROP INDEX IF EXISTS idx_memory_chunks_embedding');
  },
};

export default migration;
