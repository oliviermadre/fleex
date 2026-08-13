import type { MemoryChunkEntity, MemorySourceKind } from '../../domain/entities/memory-chunk.entity.js';

/** Structural narrowing applied before similarity is considered. */
export interface MemorySearchFilters {
  kinds?: MemorySourceKind[];
  repo?: string | null;
  boardId?: string | null;
  /** Never retrieve a ticket's own content back into its own prompt. */
  excludeTicketId?: string | null;
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

  /** Existing hashes for a source, so unchanged chunks are not re-embedded. */
  getHashesBySource(sourceKind: MemorySourceKind, sourceId: string): Promise<Map<number, string>>;

  search(queryVector: Float32Array, filters: MemorySearchFilters, limit: number): Promise<MemorySearchHit[]>;

  /**
   * Substring match over chunk content. Complements vector search for exact
   * identifiers — error codes, file paths — that embeddings blur away.
   */
  searchKeyword(term: string, filters: MemorySearchFilters, limit: number): Promise<MemoryChunkEntity[]>;

  /** Chunks with no vector yet, oldest first. Drives the embedding sweep. */
  listPendingEmbeddings(limit: number): Promise<MemoryChunkEntity[]>;

  /** Attach vectors produced by the sweep, without rewriting content. */
  setEmbeddings(entries: Array<{ id: string; embedding: Float32Array; embeddingModel: string }>): Promise<void>;

  getStats(): Promise<MemoryIndexStats>;

  /** Wipe the index. Used when the embedding model changes. */
  clear(): Promise<void>;
}
