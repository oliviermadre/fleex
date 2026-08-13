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

/** Name of the SQL function migration 034 installs. */
const MATCH_FN = 'match_memory_chunks';

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

    // PostgREST's `or` takes a comma-separated filter list, so a term containing a
    // comma would be read as two filters. Escaping the PostgREST metacharacters
    // keeps the search literal.
    const pattern = `%${trimmed.replace(/[,()%_\\]/g, (c) => `\\${c}`)}%`;
    let query = this.conn.client
      .from(TABLE)
      .select('*')
      .or(`content.ilike.${pattern},title.ilike.${pattern}`)
      .order('source_updated_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    query = applyFilters(query, filters);

    const { data, error } = await query;
    if (error) throw new Error(`memory keyword search failed: ${error.message}`);
    return (data as MemoryChunkRow[] ?? []).map(toEntity);
  }

  async listPendingEmbeddings(limit: number): Promise<MemoryChunkEntity[]> {
    const { data, error } = await this.conn.client
      .from(TABLE).select('*')
      .is('embedding', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`memory pending read failed: ${error.message}`);
    return (data as MemoryChunkRow[] ?? []).map(toEntity);
  }

  async setEmbeddings(
    entries: Array<{ id: string; embedding: Float32Array; embeddingModel: string }>,
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
            updated_at: now,
          })
          .eq('id', entry.id);
        if (error) throw new Error(`memory embedding write failed: ${error.message}`);
      }));
    }
  }

  async getStats(): Promise<MemoryIndexStats> {
    // `head: true` with an exact count returns the number without the rows, which
    // is the whole point when the table is the corpus.
    const total = await this.conn.client.from(TABLE).select('*', { count: 'exact', head: true });
    const pending = await this.conn.client
      .from(TABLE).select('*', { count: 'exact', head: true }).is('embedding', null);

    const { data: kindRows } = await this.conn.client.from(TABLE).select('source_kind, embedding_model');
    const chunksByKind: Record<string, number> = {};
    const models = new Set<string>();
    for (const row of (kindRows ?? []) as Array<{ source_kind: string; embedding_model: string | null }>) {
      chunksByKind[row.source_kind] = (chunksByKind[row.source_kind] ?? 0) + 1;
      if (row.embedding_model) models.add(row.embedding_model);
    }

    const { data: latest } = await this.conn.client
      .from(TABLE).select('updated_at').order('updated_at', { ascending: false }).limit(1);

    return {
      totalChunks: total.count ?? 0,
      pendingEmbeddings: pending.count ?? 0,
      chunksByKind,
      embeddingModels: [...models],
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
