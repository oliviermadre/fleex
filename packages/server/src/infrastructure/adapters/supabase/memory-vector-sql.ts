/**
 * The pgvector-dependent half of the Supabase memory schema.
 *
 * Kept in one place because it is applied from two: migration
 * `034_memory_pgvector_search` installs it on a fresh instance, and
 * `ensureVectorSearch` re-applies it at every boot so an instance that first
 * started without the extension repairs itself once it is enabled — a migration
 * cannot, since it records itself as applied whether or not pgvector was there.
 *
 * Every statement is idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`), which is
 * what makes running it twice cheap and running it always safe.
 */

/** Vector width. Must match the embedding provider's dimensions. */
export const VECTOR_DIMENSIONS = 384;

/** Name of the nearest-neighbour function the adapter calls by RPC. */
export const MATCH_FN = 'match_memory_chunks';

/**
 * HNSW over cosine distance. Chosen over IVFFlat because it needs no training
 * pass and stays accurate as the corpus grows — an IVFFlat index built on an
 * empty table would have to be rebuilt after the first backfill.
 */
export const EMBEDDING_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding
    ON memory_chunks USING hnsw (embedding vector_cosine_ops)
`;

/**
 * `<=>` is cosine *distance*, so similarity is 1 minus it — matching the cosine
 * similarity the JS scorer produces, so both drivers hand the ranking layer the
 * same number.
 *
 * The NULL checks on each filter make one function serve every combination:
 * passing null means "do not filter on this", which keeps the adapter from
 * needing a query per filter shape.
 *
 * `exclude_ticket_id` keeps rows whose ticket is NULL on purpose — a routine
 * deliverable or a scratchpad has no ticket and must survive the exclusion.
 */
export const MATCH_FUNCTION_SQL = `
  CREATE OR REPLACE FUNCTION ${MATCH_FN}(
    query_embedding vector(${VECTOR_DIMENSIONS}),
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
`;

/**
 * Promote the column written by an instance that booted without pgvector.
 *
 * Migration 033 falls back to `TEXT` in that case so the table can still be
 * created — the vectors stored in it are pgvector's own text form, which casts
 * across without a rewrite of the values.
 */
export const PROMOTE_COLUMN_SQL = `
  ALTER TABLE memory_chunks
    ALTER COLUMN embedding TYPE vector(${VECTOR_DIMENSIONS})
    USING embedding::vector(${VECTOR_DIMENSIONS})
`;

/** Whether the `vector` type is present in this database. */
export const VECTOR_TYPE_EXISTS_SQL = `SELECT 1 AS present FROM pg_type WHERE typname = 'vector'`;

/** The declared type of `memory_chunks.embedding`, to detect the TEXT fallback. */
export const EMBEDDING_COLUMN_TYPE_SQL = `
  SELECT udt_name FROM information_schema.columns
   WHERE table_name = 'memory_chunks' AND column_name = 'embedding'
`;
