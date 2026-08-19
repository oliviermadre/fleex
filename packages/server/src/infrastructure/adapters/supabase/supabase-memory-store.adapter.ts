import {
  MemoryChunkEntity,
  type MemoryChunkMetadata,
  type MemorySourceKind,
} from '../../../domain/entities/memory-chunk.entity.js';
import type {
  MemoryIndexStats,
  MemorySearchFilters,
  MemorySearchHit,
  MemoryStorePort,
} from '../../../application/ports/memory-store.port.js';
import type { LoggerPort } from '../../../application/ports/logger.port.js';
import type { SupabaseConnection } from './connection.js';
import {
  CLEAR_EMBEDDINGS_SQL,
  DEFAULT_VECTOR_DIMENSIONS,
  DROP_EMBEDDING_INDEX_SQL,
  DROP_LEGACY_MATCH_FN_SQL,
  EMBEDDING_COLUMN_TYPE_SQL,
  EMBEDDING_COLUMN_WIDTH_SQL,
  EMBEDDING_INDEX_SQL,
  MATCH_FN,
  matchFunctionSql,
  promoteColumnSql,
  VECTOR_TYPE_EXISTS_SQL,
} from './memory-vector-sql.js';

/**
 * Split a list into batches.
 *
 * Local and generic: `chunkIds` next door is typed for id strings, and these
 * batches are row objects and update descriptors.
 */
function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const TABLE = 'memory_chunks';

/**
 * Every column except `embedding`.
 *
 * `select('*')` would ship the vector back as its ~5 KB text form on every row
 * of every keyword search, to be thrown away — nothing outside the database ever
 * reads a stored vector.
 */
const COLUMNS = 'id,source_kind,source_id,chunk_index,ticket_id,board_id,repo,agent_name,'
  + 'tags,title,content,content_hash,embedding_model,source_updated_at,created_at,updated_at';

interface MemoryChunkRow {
  id: string;
  source_kind: string;
  source_id: string;
  chunk_index: number;
  ticket_id: string | null;
  board_id: string | null;
  repo: string | null;
  agent_name: string | null;
  tags: string;
  title: string;
  content: string;
  content_hash: string;
  embedding_model: string | null;
  source_updated_at: string | null;
  created_at: string;
  updated_at: string;
  /** Only present on rows returned by the match function. */
  similarity?: number;
}

/**
 * Supabase-backed retrieval index, scoring in the database via pgvector.
 *
 * The opposite trade to the SQLite adapter, for the opposite reason. There, the
 * corpus is a local file and a full scan costs milliseconds; here every row would
 * have to cross the network to be scored client-side, so a query would ship the
 * whole index to score eight results. The comparison therefore runs in Postgres,
 * through the `match_memory_chunks` function, and only the winners come back.
 *
 * Vectors are never selected. A `vector(384)` column comes back from PostgREST as
 * a string that would have to be parsed for no purpose — the similarity is already
 * computed, and the entity's `embedding` is only ever read by the sweep, which
 * works from ids.
 */
export class SupabaseMemoryStoreAdapter implements MemoryStorePort {
  /** Set once the match function is confirmed missing, to warn only once. */
  private matchFnMissing = false;

  constructor(
    private readonly conn: SupabaseConnection,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Bring the pgvector half of the schema up to date, at every boot.
   *
   * A migration cannot do this job alone: it records itself as applied whether or
   * not the extension was available, so a project that enabled pgvector *after*
   * its first Fleex boot would keep the TEXT column and the missing search
   * function forever, with no migration left to fix it. Every statement here is
   * idempotent, so running it on an already-correct database costs one catalogue
   * query and two no-op DDL statements.
   *
   * Failure is never fatal. Without pgvector the index still fills and keyword
   * search still works; only retrieval by meaning is unavailable, and the caller
   * falls back to the legacy ranking.
   */
  async ensureVectorSearch(dimensions = DEFAULT_VECTOR_DIMENSIONS): Promise<void> {
    // No direct connection means no DDL — the same condition under which the
    // migrations could not have run either.
    if (!this.conn.canExecuteDDL) return;

    try {
      try {
        await this.conn.query('CREATE EXTENSION IF NOT EXISTS vector');
      } catch {
        // Managed projects may forbid it; the check below decides what follows.
      }

      const present = await this.conn.query(VECTOR_TYPE_EXISTS_SQL);
      if (present.rows.length === 0) {
        this.logger.warn('Semantic memory search unavailable on Supabase', {
          reason: 'the pgvector extension is not installed',
          hint: 'Enable the "vector" extension on the project; Fleex repairs the schema on the next start.',
        });
        return;
      }

      const column = await this.conn.query(EMBEDDING_COLUMN_TYPE_SQL);
      const udt = (column.rows[0] as { udt_name?: string } | undefined)?.udt_name;
      const isVector = udt === 'vector';

      const widthRow = isVector ? await this.conn.query(EMBEDDING_COLUMN_WIDTH_SQL) : null;
      const currentWidth = (widthRow?.rows[0] as { width?: number } | undefined)?.width ?? 0;
      // A width change means the configured encoder changed to one of a different
      // size. Every stored vector is already unusable — wrong space and wrong
      // length — so they are cleared rather than cast, which puts them in the
      // sweep's backlog to be recomputed with the new model.
      const widthChanged = isVector && currentWidth > 0 && currentWidth !== dimensions;

      if (!isVector || widthChanged) {
        if (widthChanged) {
          this.logger.info('Resizing memory_chunks.embedding for a new encoder', {
            from: currentWidth, to: dimensions,
          });
          await this.conn.query(CLEAR_EMBEDDINGS_SQL);
        } else {
          // Written by a boot that had no pgvector. The stored values are already
          // pgvector's text form, so the cast is a type change, not a rewrite.
          this.logger.info('Promoting memory_chunks.embedding to vector', { from: udt ?? 'unknown' });
        }
        // An HNSW index is built for one dimensionality and cannot survive the
        // retype, so it goes first and is recreated below.
        await this.conn.query(DROP_EMBEDDING_INDEX_SQL);
        await this.conn.query(promoteColumnSql(dimensions));
      }

      await this.conn.query(EMBEDDING_INDEX_SQL);
      // Before creating: an older signature would otherwise survive as an
      // overload and keep answering queries without the model filter.
      await this.conn.query(DROP_LEGACY_MATCH_FN_SQL);
      await this.conn.query(matchFunctionSql(dimensions));
    } catch (error) {
      this.logger.warn('Could not prepare Supabase vector search', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Port hook: make the schema fit this vector width before anything is indexed.
   *
   * Named for the port rather than for pgvector so the container does not have to
   * know which driver it got — the SQLite store stores raw float32 and has nothing
   * to prepare, which is why the method is optional.
   */
  async prepare(dimensions: number): Promise<void> {
    await this.ensureVectorSearch(dimensions);
  }

  async upsertChunks(chunks: MemoryChunkEntity[]): Promise<void> {
    if (chunks.length === 0) return;

    const rows = chunks.map((chunk) => ({
      id: chunk.id,
      source_kind: chunk.sourceKind,
      source_id: chunk.sourceId,
      chunk_index: chunk.chunkIndex,
      ticket_id: chunk.metadata.ticketId ?? null,
      board_id: chunk.metadata.boardId ?? null,
      repo: chunk.metadata.repo ?? null,
      agent_name: chunk.metadata.agentName ?? null,
      tags: JSON.stringify(chunk.metadata.tags ?? []),
      title: chunk.title,
      content: chunk.content,
      content_hash: chunk.contentHash,
      // pgvector accepts its own text form; sending an array would be coerced to
      // a Postgres array and rejected by the column type.
      embedding: chunk.embedding ? toVectorLiteral(chunk.embedding) : null,
      embedding_model: chunk.embeddingModel,
      source_updated_at: chunk.sourceUpdatedAt?.toISOString() ?? null,
      created_at: chunk.createdAt.toISOString(),
      updated_at: chunk.updatedAt.toISOString(),
    }));

    // Chunked because a re-index of a long document can exceed the request size
    // PostgREST accepts in one call.
    for (const batch of chunked(rows, 200)) {
      const { error } = await this.conn.client
        .from(TABLE)
        .upsert(batch, { onConflict: 'source_kind,source_id,chunk_index' });
      if (error) throw new Error(`memory upsert failed: ${error.message}`);
    }
  }

  async deleteBySource(sourceKind: MemorySourceKind, sourceId: string): Promise<void> {
    const { error } = await this.conn.client
      .from(TABLE).delete().eq('source_kind', sourceKind).eq('source_id', sourceId);
    if (error) throw new Error(`memory delete failed: ${error.message}`);
  }

  async deleteBySourceFrom(sourceKind: MemorySourceKind, sourceId: string, fromIndex: number): Promise<void> {
    const { error } = await this.conn.client
      .from(TABLE).delete()
      .eq('source_kind', sourceKind).eq('source_id', sourceId).gte('chunk_index', fromIndex);
    if (error) throw new Error(`memory trim failed: ${error.message}`);
  }

  async listSourceIds(sourceKind: MemorySourceKind): Promise<string[]> {
    // Paged, like the stats read: PostgREST caps a response at 1000 rows, and a
    // silently truncated list here would make the pruner keep orphans while
    // reporting success.
    const ids = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.conn.client
        .from(TABLE).select('source_id').eq('source_kind', sourceKind).range(from, from + PAGE - 1);
      if (error) throw new Error(`memory source id read failed: ${error.message}`);
      const rows = (data ?? []) as Array<{ source_id: string }>;
      for (const row of rows) ids.add(row.source_id);
      if (rows.length < PAGE) break;
    }
    return [...ids];
  }

  async sampleChunks(limit: number): Promise<MemoryChunkEntity[]> {
    // PostgREST cannot order randomly, so the spread comes from a random window
    // instead: count the rows, start somewhere that leaves room for `limit`, and
    // read forward. One extra request, and no ordering bias towards the newest.
    const { count } = await this.conn.client
      .from(TABLE).select('*', { count: 'exact', head: true });
    const total = count ?? 0;
    if (total === 0) return [];

    const from = Math.max(0, Math.floor(Math.random() * Math.max(1, total - limit)));
    const { data, error } = await this.conn.client
      .from(TABLE).select(COLUMNS).order('id').range(from, from + limit - 1);
    if (error) throw new Error(`memory sample failed: ${error.message}`);
    return (data as unknown as MemoryChunkRow[] ?? []).map(toEntity);
  }

  async getHashesBySource(sourceKind: MemorySourceKind, sourceId: string): Promise<Map<number, string>> {
    const { data, error } = await this.conn.client
      .from(TABLE).select('chunk_index, content_hash')
      .eq('source_kind', sourceKind).eq('source_id', sourceId);
    if (error) throw new Error(`memory hash read failed: ${error.message}`);

    return new Map((data ?? []).map((r) => [r.chunk_index as number, r.content_hash as string]));
  }

  async refreshMetadata(
    sourceKind: MemorySourceKind,
    sourceId: string,
    metadata: MemoryChunkMetadata,
  ): Promise<void> {
    const { error } = await this.conn.client
      .from(TABLE)
      .update({
        ticket_id: metadata.ticketId ?? null,
        board_id: metadata.boardId ?? null,
        repo: metadata.repo ?? null,
        agent_name: metadata.agentName ?? null,
        tags: JSON.stringify(metadata.tags ?? []),
        updated_at: new Date().toISOString(),
      })
      .eq('source_kind', sourceKind).eq('source_id', sourceId);
    if (error) throw new Error(`memory metadata refresh failed: ${error.message}`);
  }

  async search(
    queryVector: Float32Array,
    filters: MemorySearchFilters,
    limit: number,
  ): Promise<MemorySearchHit[]> {
    const { data, error } = await this.conn.client.rpc(MATCH_FN, {
      query_embedding: toVectorLiteral(queryVector),
      match_limit: limit,
      filter_kinds: filters.kinds?.length ? filters.kinds : null,
      filter_repo: filters.repo ?? null,
      filter_board_id: filters.boardId ?? null,
      exclude_ticket_id: filters.excludeTicketId ?? null,
      filter_model: filters.embeddingModel ?? null,
    });

    if (error) {
      // A missing function means migration 034 could not install pgvector — a
      // deployment fact, not a per-query failure, so it is reported once and the
      // caller degrades to the legacy ranking instead of erroring on every run.
      if (!this.matchFnMissing) {
        this.matchFnMissing = true;
        this.logger.warn('Semantic search unavailable on Supabase', {
          reason: error.message,
          hint: `Install pgvector and re-run migrations so ${MATCH_FN} exists.`,
        });
      }
      return [];
    }

    return (data as MemoryChunkRow[] ?? []).map((row) => ({
      chunk: toEntity(row),
      similarity: typeof row.similarity === 'number' ? row.similarity : 0,
    }));
  }

  async searchKeyword(
    term: string,
    filters: MemorySearchFilters,
    limit: number,
  ): Promise<MemoryChunkEntity[]> {
    const trimmed = term.trim();
    if (!trimmed) return [];

    // Two levels of escaping, because there are two parsers. `%` and `_` are
    // ILIKE wildcards and are backslash-escaped so a search for `ERR_CONN` does
    // not match `ERRXCONN`. Then the whole pattern is double-quoted: PostgREST
    // reads `or=(…)` as a comma-separated list, so a term containing a comma or a
    // parenthesis would otherwise be parsed as another filter.
    const escaped = trimmed
      .replace(/[\\%_]/g, (c) => `\\${c}`)
      .replace(/"/g, '\\"');
    const pattern = `"%${escaped}%"`;
    let query = this.conn.client
      .from(TABLE)
      .select(COLUMNS)
      .or(`content.ilike.${pattern},title.ilike.${pattern}`)
      .order('source_updated_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    // No model filter on the keyword path: a substring match reads no vector, so
    // a chunk awaiting re-embedding is still a valid hit.
    const { embeddingModel: _ignoredModel, ...keywordFilters } = filters;
    query = applyFilters(query, keywordFilters);

    const { data, error } = await query;
    if (error) throw new Error(`memory keyword search failed: ${error.message}`);
    return (data as unknown as MemoryChunkRow[] ?? []).map(toEntity);
  }

  async listPendingEmbeddings(limit: number, activeModel?: string | null): Promise<MemoryChunkEntity[]> {
    // Two queries rather than one `or`, because each arm has an index and their
    // disjunction has none: an `or` across three predicates forced a sequential
    // scan of a table whose heap carries a vector per row, which on a live instance
    // ran past Postgres' statement timeout every single minute — so the sweep
    // failed silently and deferred chunks were never embedded.
    const missing = await this.readPending(
      this.conn.client.from(TABLE).select(COLUMNS)
        .is('embedding', null)
        .order('created_at', { ascending: true })
        .limit(limit),
    );
    if (!activeModel || missing.length >= limit) return missing;

    // Embedded by a superseded model. Served by the index migration 033 created on
    // `embedding_model`, and unordered on purpose: any stale row will do, and an
    // ordering would cost a sort the index cannot provide.
    const stale = await this.readPending(
      this.conn.client.from(TABLE).select(COLUMNS)
        .not('embedding', 'is', null)
        .neq('embedding_model', activeModel)
        .limit(limit - missing.length),
    );
    return [...missing, ...stale];
  }

  /** Shared tail of the two backlog queries. */
  private async readPending(
    query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<MemoryChunkEntity[]> {
    const { data, error } = await query;
    if (error) throw new Error(`memory pending read failed: ${error.message}`);
    return (data as MemoryChunkRow[] ?? []).map(toEntity);
  }

  async setEmbeddings(
    entries: Array<{
      id: string;
      embedding: Float32Array;
      embeddingModel: string;
      expectedContentHash: string;
      contentHash: string;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const now = new Date().toISOString();

    // One update per row: PostgREST has no bulk-update-by-id, and an upsert would
    // need every column, which would mean re-sending the content to attach a vector.
    for (const batch of chunked(entries, 25)) {
      await Promise.all(batch.map(async (entry) => {
        const { error } = await this.conn.client
          .from(TABLE)
          .update({
            embedding: toVectorLiteral(entry.embedding),
            embedding_model: entry.embeddingModel,
            content_hash: entry.contentHash,
            updated_at: now,
          })
          .eq('id', entry.id)
          // The guard: a chunk re-ingested while its vector was being computed has
          // a different hash, so this matches nothing and the stale vector is
          // dropped rather than attached to text it does not describe.
          .eq('content_hash', entry.expectedContentHash);
        if (error) throw new Error(`memory embedding write failed: ${error.message}`);
      }));
    }
  }

  async getStats(activeModel?: string | null): Promise<MemoryIndexStats> {
    // `head: true` with an exact count returns the number without the rows, which
    // is the whole point when the table is the corpus.
    const total = await this.conn.client.from(TABLE).select('*', { count: 'exact', head: true });
    const pending = await this.conn.client
      .from(TABLE).select('*', { count: 'exact', head: true }).is('embedding', null);

    // Paged explicitly: PostgREST caps a response at 1000 rows, so a single
    // select would have counted the first page and reported a corpus of 1000 —
    // a wrong number that looks plausible, which is the worst kind.
    const chunksByKind: Record<string, number> = {};
    const models = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.conn.client
        .from(TABLE).select('source_kind, embedding_model').range(from, from + PAGE - 1);
      if (error) throw new Error(`memory stats read failed: ${error.message}`);
      const rows = (data ?? []) as Array<{ source_kind: string; embedding_model: string | null }>;
      for (const row of rows) {
        chunksByKind[row.source_kind] = (chunksByKind[row.source_kind] ?? 0) + 1;
        if (row.embedding_model) models.add(row.embedding_model);
      }
      if (rows.length < PAGE) break;
    }

    // Counted server-side rather than from the paged rows above: an exact count
    // with `head` is one cheap request and cannot drift from the page size.
    const staleCount = activeModel
      ? await this.conn.client
          .from(TABLE).select('*', { count: 'exact', head: true })
          .not('embedding', 'is', null)
          .neq('embedding_model', activeModel)
      : null;

    const { data: latest } = await this.conn.client
      .from(TABLE).select('updated_at').order('updated_at', { ascending: false }).limit(1);

    return {
      totalChunks: total.count ?? 0,
      pendingEmbeddings: pending.count ?? 0,
      chunksByKind,
      embeddingModels: [...models],
      staleModelChunks: staleCount?.count ?? 0,
      lastIndexedAt: (latest as Array<{ updated_at: string }> | null)?.[0]?.updated_at ?? null,
    };
  }

  async clear(): Promise<void> {
    // PostgREST requires a filter on delete; `id <> ''` matches every row.
    const { error } = await this.conn.client.from(TABLE).delete().neq('id', '');
    if (error) throw new Error(`memory clear failed: ${error.message}`);
  }
}

/** Apply the shared structural filters to a PostgREST query builder. */
function applyFilters<T>(query: T, filters: MemorySearchFilters): T {
  let q = query as never as {
    in: (col: string, values: readonly string[]) => typeof q;
    eq: (col: string, value: unknown) => typeof q;
    or: (filter: string) => typeof q;
  };

  if (filters.kinds?.length) q = q.in('source_kind', filters.kinds);
  if (filters.repo) q = q.eq('repo', filters.repo);
  if (filters.boardId) q = q.eq('board_id', filters.boardId);
  if (filters.excludeTicketId) {
    // Same rule as SQLite: a chunk with no ticket must survive the exclusion, and
    // a bare `neq` drops NULLs because SQL comparisons against NULL are not true.
    q = q.or(`ticket_id.is.null,ticket_id.neq.${filters.excludeTicketId}`);
  }
  return q as never as T;
}

/**
 * pgvector's text input form: `[0.1,0.2,...]`.
 *
 * Sent as a string rather than a JS array because PostgREST would otherwise
 * serialise the array as a Postgres array literal, which the `vector` type
 * rejects.
 */
export function toVectorLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(',')}]`;
}

function toEntity(row: MemoryChunkRow): MemoryChunkEntity {
  return new MemoryChunkEntity(
    row.id,
    row.source_kind as MemorySourceKind,
    row.source_id,
    row.chunk_index,
    row.title,
    row.content,
    row.content_hash,
    {
      ticketId: row.ticket_id,
      boardId: row.board_id,
      repo: row.repo,
      agentName: row.agent_name,
      tags: safeParseTags(row.tags),
    },
    // Never selected — see the class comment.
    null,
    row.embedding_model,
    row.source_updated_at ? new Date(row.source_updated_at) : null,
    new Date(row.created_at),
    new Date(row.updated_at),
  );
}

function safeParseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
