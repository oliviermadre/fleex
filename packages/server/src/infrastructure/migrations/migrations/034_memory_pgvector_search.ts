import type { Migration } from '../types.js';

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

    // HNSW over cosine distance. Chosen over IVFFlat because it needs no training
    // pass and stays accurate as the corpus grows — an IVFFlat index built on an
    // empty table would have to be rebuilt after the first backfill.
    await ctx.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding
        ON memory_chunks USING hnsw (embedding vector_cosine_ops)
    `);

    // `<=>` is cosine *distance*, so similarity is 1 minus it — matching the
    // cosine similarity the JS scorer produces, so both drivers hand the ranking
    // layer the same number.
    //
    // The NULL checks on each filter make one function serve every combination:
    // passing null means "do not filter on this", which keeps the adapter from
    // needing a query per filter shape.
    //
    // `exclude_ticket_id` keeps rows whose ticket is NULL on purpose — a routine
    // deliverable or a scratchpad has no ticket and must survive the exclusion.
    await ctx.exec(`
      CREATE OR REPLACE FUNCTION match_memory_chunks(
        query_embedding vector(384),
        match_limit int DEFAULT 8,
        filter_kinds text[] DEFAULT NULL,
        filter_repo text DEFAULT NULL,
        filter_board_id text DEFAULT NULL,
        exclude_ticket_id text DEFAULT NULL
      )
      RETURNS TABLE (
        id text,
        source_kind text,
        source_id text,
        chunk_index int,
        ticket_id text,
        board_id text,
        repo text,
        agent_name text,
        tags text,
        title text,
        content text,
        content_hash text,
        embedding_model text,
        source_updated_at timestamptz,
        created_at timestamptz,
        updated_at timestamptz,
        similarity float
      )
      LANGUAGE sql STABLE
      AS $$
        SELECT
          m.id, m.source_kind, m.source_id, m.chunk_index,
          m.ticket_id, m.board_id, m.repo, m.agent_name, m.tags,
          m.title, m.content, m.content_hash, m.embedding_model,
          m.source_updated_at, m.created_at, m.updated_at,
          1 - (m.embedding <=> query_embedding) AS similarity
        FROM memory_chunks m
        WHERE m.embedding IS NOT NULL
          AND (filter_kinds IS NULL OR m.source_kind = ANY(filter_kinds))
          AND (filter_repo IS NULL OR m.repo = filter_repo)
          AND (filter_board_id IS NULL OR m.board_id = filter_board_id)
          AND (exclude_ticket_id IS NULL OR m.ticket_id IS NULL OR m.ticket_id <> exclude_ticket_id)
        ORDER BY m.embedding <=> query_embedding
        LIMIT match_limit
      $$
    `);
  },

  async down(ctx) {
    if (ctx.adapter !== 'supabase') return;
    await ctx.exec('DROP FUNCTION IF EXISTS match_memory_chunks(vector, int, text[], text, text, text)');
    await ctx.exec('DROP INDEX IF EXISTS idx_memory_chunks_embedding');
  },
};

export default migration;
