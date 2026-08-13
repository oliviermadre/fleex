import type { Migration, MigrationContext } from '../types.js';
import { VECTOR_TYPE_EXISTS_SQL } from '../../adapters/supabase/memory-vector-sql.js';

/** Whether pgvector's `vector` type can be referenced in a column definition. */
async function hasVectorType(ctx: MigrationContext): Promise<boolean> {
  try {
    return (await ctx.query(VECTOR_TYPE_EXISTS_SQL)).length > 0;
  } catch {
    return false;
  }
}

/**
 * `memory_chunks` — the retrieval index behind the semantic memory engine.
 *
 * Context injection currently reads one deliverable type (`ticket-summary`) and
 * ranks it by tag overlap and recency, so everything else an instance knows —
 * comment threads, routine outputs, scratchpads, persona memory — is invisible
 * to agents. This table is the single place all of it becomes retrievable: one
 * row per embeddable slice of content, carrying enough metadata
 * (`ticket_id`, `board_id`, `repo`, `tags`) to keep the existing structural
 * boosts working alongside vector similarity.
 *
 * Storage differs by dialect because the right answer differs:
 *  - sqlite/pgsql hold the vector as raw little-endian float32 (BLOB/BYTEA) and
 *    score in JS. At single-user scale — a heavy year is ~15k chunks, ~10 MB of
 *    vectors — a brute-force cosine is a few milliseconds, and it avoids
 *    `sqlite-vec`, whose extension loading needs a custom libsqlite3 on macOS.
 *  - supabase gets a real `vector` column: PostgREST would otherwise ship the
 *    whole corpus over the network for every query. The index and match
 *    function land in a follow-up migration, once pgvector is confirmed present.
 *
 * `content_hash` is what makes ingestion cheap to re-run: a backfill compares
 * hashes and only re-embeds what changed, so restarts and event replays are
 * no-ops rather than a full re-index. `embedding_model` records which model
 * produced the vector, so switching models invalidates rows instead of silently
 * mixing incompatible vector spaces.
 */
const migration: Migration = {
  name: '033_memory_chunks',

  async up(ctx) {
    const tsType = ctx.dialect({ sqlite: 'TEXT', pgsql: 'TIMESTAMPTZ', supabase: 'TIMESTAMPTZ' });
    const tsDefault = ctx.dialect({
      sqlite: "DEFAULT (datetime('now'))",
      pgsql: 'DEFAULT NOW()',
      supabase: 'DEFAULT NOW()',
    });
    // Nullable on purpose: a chunk is stored the moment its content is known and
    // embedded afterwards, so a provider that is still downloading its model
    // never blocks ingestion. A sweep fills the gaps.
    let embeddingType = ctx.dialect({
      sqlite: 'BLOB',
      pgsql: 'BYTEA',
      supabase: 'vector(384)',
    });

    if (ctx.adapter === 'supabase') {
      // Idempotent, and a no-op when the extension is already installed.
      try {
        await ctx.exec('CREATE EXTENSION IF NOT EXISTS vector');
      } catch {
        // Managed instances may forbid it.
      }
      // Whether it worked decides the column type. Declaring `vector(384)` when
      // the type does not exist would fail the CREATE TABLE below, and with it
      // the migration chain and the whole boot — a missing optional extension
      // must cost the semantic engine, not the instance. The vectors are stored
      // in pgvector's text form either way, so `ensureVectorSearch` can promote
      // the column with a plain cast once the extension appears.
      if (!(await hasVectorType(ctx))) embeddingType = 'TEXT';
    }

    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id TEXT PRIMARY KEY,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        ticket_id TEXT,
        board_id TEXT,
        repo TEXT,
        agent_name TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding ${embeddingType},
        embedding_model TEXT,
        source_updated_at ${tsType},
        created_at ${tsType} NOT NULL ${tsDefault},
        updated_at ${tsType} NOT NULL ${tsDefault},
        UNIQUE(source_kind, source_id, chunk_index)
      )
    `);

    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_memory_chunks_source ON memory_chunks(source_kind, source_id)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_memory_chunks_ticket ON memory_chunks(ticket_id)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_memory_chunks_repo ON memory_chunks(repo)');
    // Drives the sweep that embeds rows ingested while the model was unavailable.
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_memory_chunks_model ON memory_chunks(embedding_model)');

    // Supabase RLS (cf. CLAUDE.md)
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE memory_chunks ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_memory_chunks" ON memory_chunks FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS memory_chunks');
  },
};

export default migration;
