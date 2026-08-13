import {
  MemoryChunkEntity,
  decodeEmbedding,
  encodeEmbedding,
  type MemorySourceKind,
} from '../../../domain/entities/memory-chunk.entity.js';
import type {
  MemoryIndexStats,
  MemorySearchFilters,
  MemorySearchHit,
  MemoryStorePort,
} from '../../../application/ports/memory-store.port.js';
import { cosineSimilarity } from '../../../application/memory/scoring.js';
import type { SqliteConnection } from './connection.js';

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
  embedding: Uint8Array | null;
  embedding_model: string | null;
  source_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * SQLite-backed retrieval index, scoring cosine similarity in JS.
 *
 * No ANN index and no `sqlite-vec`: at single-user scale the corpus is a few
 * thousand vectors (a heavy year is ~15k, about 10 MB at 384 dimensions), so a
 * full scan costs single-digit milliseconds — well below the point where an
 * index pays for itself, and far below the cost of requiring a custom-built
 * libsqlite3 on macOS, which is what extension loading would impose on every
 * install.
 *
 * Vectors are cached in process because decoding 15k BLOBs per query is the part
 * that would actually hurt. The cache is keyed by row id and dropped wholesale
 * on any write: invalidating precisely would mean tracking which rows a
 * re-chunk replaced, and a rebuild costs one scan.
 */
export class SqliteMemoryStoreAdapter implements MemoryStorePort {
  /** Decoded vectors, rebuilt on first use after any write. */
  private cacheMap: Map<string, Float32Array> | null = null;

  constructor(private readonly conn: SqliteConnection) {}

  async upsertChunks(chunks: MemoryChunkEntity[]): Promise<void> {
    if (chunks.length === 0) return;

    const stmt = this.conn.db.prepare(`
      INSERT INTO memory_chunks
        (id, source_kind, source_id, chunk_index, ticket_id, board_id, repo, agent_name,
         tags, title, content, content_hash, embedding, embedding_model,
         source_updated_at, created_at, updated_at)
      VALUES
        (@id, @source_kind, @source_id, @chunk_index, @ticket_id, @board_id, @repo, @agent_name,
         @tags, @title, @content, @content_hash, @embedding, @embedding_model,
         @source_updated_at, @created_at, @updated_at)
      ON CONFLICT(source_kind, source_id, chunk_index) DO UPDATE SET
        ticket_id = excluded.ticket_id,
        board_id = excluded.board_id,
        repo = excluded.repo,
        agent_name = excluded.agent_name,
        tags = excluded.tags,
        title = excluded.title,
        content = excluded.content,
        content_hash = excluded.content_hash,
        embedding = excluded.embedding,
        embedding_model = excluded.embedding_model,
        source_updated_at = excluded.source_updated_at,
        updated_at = excluded.updated_at
    `);

    // One transaction for the whole set: a re-chunk writes every chunk of a
    // source, and a partial write would leave the index describing a document
    // that never existed.
    this.inTransaction(() => {
      for (const chunk of chunks) {
        stmt.run({
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
          embedding: chunk.embedding ? encodeEmbedding(chunk.embedding) : null,
          embedding_model: chunk.embeddingModel,
          source_updated_at: chunk.sourceUpdatedAt?.toISOString() ?? null,
          created_at: chunk.createdAt.toISOString(),
          updated_at: chunk.updatedAt.toISOString(),
        });
      }
    });
    this.invalidateCache();
  }

  async deleteBySource(sourceKind: MemorySourceKind, sourceId: string): Promise<void> {
    this.conn.db
      .prepare('DELETE FROM memory_chunks WHERE source_kind = ? AND source_id = ?')
      .run(sourceKind, sourceId);
    this.invalidateCache();
  }

  async deleteBySourceFrom(sourceKind: MemorySourceKind, sourceId: string, fromIndex: number): Promise<void> {
    this.conn.db
      .prepare('DELETE FROM memory_chunks WHERE source_kind = ? AND source_id = ? AND chunk_index >= ?')
      .run(sourceKind, sourceId, fromIndex);
    this.invalidateCache();
  }

  async getHashesBySource(sourceKind: MemorySourceKind, sourceId: string): Promise<Map<number, string>> {
    const rows = this.conn.db
      .prepare('SELECT chunk_index, content_hash FROM memory_chunks WHERE source_kind = ? AND source_id = ?')
      .all(sourceKind, sourceId) as Array<{ chunk_index: number; content_hash: string }>;
    return new Map(rows.map((r) => [r.chunk_index, r.content_hash]));
  }

  async search(queryVector: Float32Array, filters: MemorySearchFilters, limit: number): Promise<MemorySearchHit[]> {
    // Filter in SQL, score in JS: the WHERE clause is what keeps the scan small
    // when the caller has narrowed to one repo or kind.
    const { sql, params } = this.buildFilterClause(filters, 'embedding IS NOT NULL');
    const rows = this.conn.db
      .prepare(`SELECT * FROM memory_chunks ${sql}`)
      .all(...params) as MemoryChunkRow[];
    if (rows.length === 0) return [];

    const vectors = this.getVectorCache();
    const scored: MemorySearchHit[] = [];

    for (const row of rows) {
      const cached = vectors.get(row.id);
      const vector = cached ?? decodeEmbedding(row.embedding);
      if (!vector) continue;
      // Mismatched widths mean the row predates a model switch; skip rather than
      // score it against an incompatible space.
      if (vector.length !== queryVector.length) continue;
      scored.push({ chunk: this.toEntity(row, vector), similarity: cosineSimilarity(queryVector, vector) });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  async searchKeyword(term: string, filters: MemorySearchFilters, limit: number): Promise<MemoryChunkEntity[]> {
    const trimmed = term.trim();
    if (!trimmed) return [];
    // Escape the LIKE wildcards so a query containing `%` or `_` matches
    // literally instead of turning into a full scan match.
    const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { sql, params } = this.buildFilterClause(
      filters,
      "(content LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')",
      [pattern, pattern],
    );
    const rows = this.conn.db
      .prepare(`SELECT * FROM memory_chunks ${sql} ORDER BY source_updated_at DESC LIMIT ?`)
      .all(...params, limit) as MemoryChunkRow[];
    return rows.map((r) => this.toEntity(r, decodeEmbedding(r.embedding)));
  }

  async listPendingEmbeddings(limit: number): Promise<MemoryChunkEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM memory_chunks WHERE embedding IS NULL ORDER BY created_at ASC LIMIT ?')
      .all(limit) as MemoryChunkRow[];
    return rows.map((r) => this.toEntity(r, null));
  }

  async setEmbeddings(entries: Array<{ id: string; embedding: Float32Array; embeddingModel: string }>): Promise<void> {
    if (entries.length === 0) return;
    const stmt = this.conn.db.prepare(
      'UPDATE memory_chunks SET embedding = ?, embedding_model = ?, updated_at = ? WHERE id = ?',
    );
    const now = new Date().toISOString();
    this.inTransaction(() => {
      for (const entry of entries) {
        stmt.run(encodeEmbedding(entry.embedding), entry.embeddingModel, now, entry.id);
      }
    });
    this.invalidateCache();
  }

  async getStats(): Promise<MemoryIndexStats> {
    const total = this.conn.db.prepare('SELECT COUNT(*) AS n FROM memory_chunks').get() as { n: number };
    const pending = this.conn.db
      .prepare('SELECT COUNT(*) AS n FROM memory_chunks WHERE embedding IS NULL')
      .get() as { n: number };
    const byKind = this.conn.db
      .prepare('SELECT source_kind, COUNT(*) AS n FROM memory_chunks GROUP BY source_kind')
      .all() as Array<{ source_kind: string; n: number }>;
    const models = this.conn.db
      .prepare('SELECT DISTINCT embedding_model AS m FROM memory_chunks WHERE embedding_model IS NOT NULL')
      .all() as Array<{ m: string }>;
    const last = this.conn.db
      .prepare('SELECT MAX(updated_at) AS t FROM memory_chunks')
      .get() as { t: string | null };

    return {
      totalChunks: total.n,
      pendingEmbeddings: pending.n,
      chunksByKind: Object.fromEntries(byKind.map((r) => [r.source_kind, r.n])),
      embeddingModels: models.map((r) => r.m),
      lastIndexedAt: last.t ?? null,
    };
  }

  async clear(): Promise<void> {
    this.conn.db.prepare('DELETE FROM memory_chunks').run();
    this.invalidateCache();
  }

  // ─── Internals ───

  /**
   * Build the shared WHERE clause. `extraSql`/`extraParams` carry the
   * caller-specific predicate (embedding presence, LIKE match) so both search
   * paths apply the structural filters identically.
   */
  private buildFilterClause(
    filters: MemorySearchFilters,
    extraSql?: string,
    extraParams: unknown[] = [],
  ): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (extraSql) {
      clauses.push(extraSql);
      params.push(...extraParams);
    }
    if (filters.kinds?.length) {
      clauses.push(`source_kind IN (${filters.kinds.map(() => '?').join(', ')})`);
      params.push(...filters.kinds);
    }
    if (filters.repo) {
      clauses.push('repo = ?');
      params.push(filters.repo);
    }
    if (filters.boardId) {
      clauses.push('board_id = ?');
      params.push(filters.boardId);
    }
    if (filters.excludeTicketId) {
      // `IS NULL OR <>` rather than `<>`: a chunk with no ticket (a routine
      // deliverable, a scratchpad) must survive the exclusion, and SQL
      // comparisons against NULL are never true.
      clauses.push('(ticket_id IS NULL OR ticket_id <> ?)');
      params.push(filters.excludeTicketId);
    }

    return {
      sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  private getVectorCache(): Map<string, Float32Array> {
    if (!this.cacheMap) {
      const rows = this.conn.db
        .prepare('SELECT id, embedding FROM memory_chunks WHERE embedding IS NOT NULL')
        .all() as Array<{ id: string; embedding: Uint8Array }>;
      this.cacheMap = new Map();
      for (const row of rows) {
        const vector = decodeEmbedding(row.embedding);
        if (vector) this.cacheMap.set(row.id, vector);
      }
    }
    return this.cacheMap;
  }

  private invalidateCache(): void {
    this.cacheMap = null;
  }

  /**
   * Explicit BEGIN/COMMIT, because the shared `SqliteConnection` wrapper exposes
   * only `prepare` and `exec` — it does not surface bun:sqlite's `transaction`
   * helper.
   */
  private inTransaction(work: () => void): void {
    this.conn.db.exec('BEGIN');
    try {
      work();
      this.conn.db.exec('COMMIT');
    } catch (error) {
      this.conn.db.exec('ROLLBACK');
      throw error;
    }
  }

  private toEntity(row: MemoryChunkRow, embedding: Float32Array | null): MemoryChunkEntity {
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
      embedding,
      row.embedding_model,
      row.source_updated_at ? new Date(row.source_updated_at) : null,
      new Date(row.created_at),
      new Date(row.updated_at),
    );
  }
}

function safeParseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
