import type { MemoryChunkEntity, MemoryChunkMetadata, MemorySourceKind } from '../../domain/entities/memory-chunk.entity.js';

/** Structural narrowing applied before similarity is considered. */
export interface MemorySearchFilters {
  kinds?: MemorySourceKind[];
  repo?: string | null;
  boardId?: string | null;
  /** Never retrieve a ticket's own content back into its own prompt. */
  excludeTicketId?: string | null;
  /**
   * Only consider vectors produced by this model.
   *
   * Vectors from different encoders live in different spaces, so comparing them
   * yields a number that looks like a similarity and means nothing. After a model
   * change the index holds both until the sweep catches up, and this is what keeps
   * the old ones out of the ranking instead of letting them outrank real matches.
   */
  embeddingModel?: string | null;
}

/** A chunk plus the similarity that retrieved it. */
export interface MemorySearchHit {
  chunk: MemoryChunkEntity;
  /** Cosine similarity in [-1, 1]; the hybrid score is computed above this. */
  similarity: number;
}

export interface MemoryIndexStats {
  totalChunks: number;
  /** Rows still awaiting a vector — the sweep's backlog. */
  pendingEmbeddings: number;
  chunksByKind: Record<string, number>;
  /** Distinct embedding models present. More than one means a switch is mid-flight. */
  embeddingModels: string[];
  /**
   * Chunks holding a vector from a model other than the active one.
   *
   * Counted separately from `pendingEmbeddings` because the cause differs: these
   * are not waiting on a download, they are waiting to be re-embedded after a
   * model change. Both are drained by the same sweep.
   */
  staleModelChunks: number;
  lastIndexedAt: string | null;
}

/**
 * Persistence for the retrieval index.
 *
 * `search` takes a query vector rather than text: embedding is the provider's
 * job, and keeping it out of the store is what lets one implementation score in
 * JS (sqlite/pgsql, where the corpus is small enough to scan) while another
 * pushes the same query down to pgvector (supabase, where shipping the corpus
 * over the network would be absurd). Callers cannot tell which they got.
 */
export interface MemoryStorePort {
  /**
   * Insert or replace chunks, keyed on `(sourceKind, sourceId, chunkIndex)`.
   * Callers pass a source's full chunk set; see `deleteBySource` for trimming.
   */
  upsertChunks(chunks: MemoryChunkEntity[]): Promise<void>;

  /** Remove every chunk of a source — used on delete and before a re-chunk. */
  deleteBySource(sourceKind: MemorySourceKind, sourceId: string): Promise<void>;

  /** Drop chunks whose index is at or beyond `fromIndex`, after a source shrank. */
  deleteBySourceFrom(sourceKind: MemorySourceKind, sourceId: string, fromIndex: number): Promise<void>;

  /**
   * Distinct source ids currently indexed under a kind.
   *
   * Lets a backfill find chunks whose source no longer exists — deleted while the
   * server was down, or through a path that emitted no event. Without it the index
   * keeps answering with content the workspace no longer has, which is worse than
   * missing content because nothing about the answer looks wrong.
   */
  listSourceIds(sourceKind: MemorySourceKind): Promise<string[]>;

  /** Existing hashes for a source, so unchanged chunks are not re-embedded. */
  getHashesBySource(sourceKind: MemorySourceKind, sourceId: string): Promise<Map<number, string>>;

  /**
   * Update the scoring metadata of every chunk of a source, leaving content and
   * vectors alone.
   *
   * Needed because the content hash covers text only: retagging a ticket or
   * linking a repo changes how its chunks should score without changing a word of
   * them. Without this, unchanged chunks would keep the metadata they were first
   * indexed with — and re-embedding them just to refresh a tag would be pure
   * waste, since the vector is identical.
   */
  refreshMetadata(
    sourceKind: MemorySourceKind,
    sourceId: string,
    metadata: MemoryChunkMetadata,
  ): Promise<void>;

  search(queryVector: Float32Array, filters: MemorySearchFilters, limit: number): Promise<MemorySearchHit[]>;

  /**
   * Substring match over chunk content. Complements vector search for exact
   * identifiers — error codes, file paths — that embeddings blur away.
   */
  searchKeyword(term: string, filters: MemorySearchFilters, limit: number): Promise<MemoryChunkEntity[]>;

  /**
   * Chunks the sweep has to embed, oldest first: those with no vector, and —
   * when `activeModel` is given — those carrying a vector from another model.
   *
   * Folding the two into one query is what makes a model switch self-healing: the
   * same sweep that finishes an interrupted download also migrates the index,
   * without the user having to know a reindex was needed.
   */
  listPendingEmbeddings(limit: number, activeModel?: string | null): Promise<MemoryChunkEntity[]>;

  /**
   * Attach vectors produced by the sweep, without rewriting content.
   *
   * `expectedContentHash` is a guard, not bookkeeping: embedding takes long
   * enough that the chunk can be re-ingested with new text while its vector is
   * being computed, and writing that vector by id alone would attach it to text
   * it does not describe — permanently, since the row would no longer look
   * pending. A row whose hash moved is left alone for the next pass.
   */
  setEmbeddings(entries: Array<{
    id: string;
    embedding: Float32Array;
    embeddingModel: string;
    expectedContentHash: string;
    /** Hash for the new model, so the ingestion diff does not see a mismatch. */
    contentHash: string;
  }>): Promise<void>;

  /**
   * Index counters. `activeModel` is what makes `staleModelChunks` meaningful —
   * the store has no opinion on which model is configured.
   */
  getStats(activeModel?: string | null): Promise<MemoryIndexStats>;

  /** Wipe the index. Used when the embedding model changes. */
  clear(): Promise<void>;

  /**
   * Optional: make the storage fit a vector width before anything is written.
   *
   * Only a driver whose schema declares the width needs this — Supabase's
   * `vector(N)` column and its index and search function all carry it, while the
   * SQLite store keeps raw float32 and is width-agnostic. Called once at boot
   * with the configured encoder's width; failures are logged, never fatal.
   */
  prepare?(dimensions: number): Promise<void>;
}
