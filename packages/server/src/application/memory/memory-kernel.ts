import { MemoryChunkEntity, hashChunkContent, type MemorySourceKind } from '../../domain/entities/memory-chunk.entity.js';
import type { EmbeddingProviderPort } from '../ports/embedding-provider.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { MemoryStorePort } from '../ports/memory-store.port.js';
import { embeddableText, type DraftChunk } from './chunker.js';

/** How many pending rows one sweep pass embeds. */
const SWEEP_BATCH = 64;

export interface IngestOutcome {
  /** Chunks written for the first time or whose content changed. */
  embedded: number;
  /** Chunks left untouched because their hash matched. */
  unchanged: number;
  /** Stale trailing chunks removed after the source shrank. */
  removed: number;
  /** Chunks stored without a vector because the provider was unavailable. */
  deferred: number;
}

const EMPTY_OUTCOME: IngestOutcome = { embedded: 0, unchanged: 0, removed: 0, deferred: 0 };

/**
 * Turns drafted chunks into indexed, embedded rows.
 *
 * The kernel is deliberately hash-first: it asks the store what it already holds
 * for a source and only embeds what actually changed. Without that, every ticket
 * save would re-embed its whole comment thread, and a backfill could never be
 * re-run to resume — both of which matter more than they sound, because ingestion
 * is driven by events that fire far more often than content really changes.
 *
 * Embedding failure is never fatal. Chunks are written with a null vector and
 * picked up by `sweepPendingEmbeddings`, so a model that is still downloading
 * delays retrieval instead of losing content.
 */
export class MemoryKernel {
  constructor(
    private readonly store: MemoryStorePort,
    private readonly embeddings: EmbeddingProviderPort,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Index the full chunk set of one source, replacing what was there.
   *
   * Callers pass every chunk the source currently yields; the kernel diffs
   * against stored hashes and trims any tail left over from a longer previous
   * version. An empty list therefore *deletes* the source, which is what a
   * cleared scratchpad or an emptied description should do.
   */
  async ingest(
    sourceKind: MemorySourceKind,
    sourceId: string,
    drafts: DraftChunk[],
  ): Promise<IngestOutcome> {
    if (drafts.length === 0) {
      await this.store.deleteBySource(sourceKind, sourceId);
      return EMPTY_OUTCOME;
    }

    const existing = await this.store.getHashesBySource(sourceKind, sourceId);
    const modelId = this.embeddings.id;

    const changed: DraftChunk[] = [];
    let unchanged = 0;
    for (const draft of drafts) {
      const hash = hashChunkContent(draft.content, modelId);
      if (existing.get(draft.chunkIndex) === hash) unchanged++;
      else changed.push(draft);
    }

    // Trim first: a source that shrank leaves rows whose content no longer
    // exists, and they would keep answering queries.
    let removed = 0;
    const maxIndex = Math.max(...drafts.map((d) => d.chunkIndex));
    for (const index of existing.keys()) {
      if (index > maxIndex) removed++;
    }
    if (removed > 0) await this.store.deleteBySourceFrom(sourceKind, sourceId, maxIndex + 1);

    // Metadata is not part of the hash, because retagging a ticket or linking a
    // repo changes how its chunks should score without changing a word of them.
    // Unchanged chunks are therefore skipped by the diff but still need their
    // metadata brought up to date — re-embedding them for a tag would be waste.
    if (unchanged > 0 && drafts[0]) {
      await this.store.refreshMetadata(sourceKind, sourceId, drafts[0].metadata);
    }

    if (changed.length === 0) return { embedded: 0, unchanged, removed, deferred: 0 };

    const vectors = await this.embedOrDefer(changed);
    await this.store.upsertChunks(changed.map((draft, i) => MemoryChunkEntity.create({
      sourceKind: draft.sourceKind,
      sourceId: draft.sourceId,
      chunkIndex: draft.chunkIndex,
      title: draft.title,
      content: draft.content,
      metadata: draft.metadata,
      embedding: vectors?.[i] ?? null,
      // The hash covers the model id, so a chunk stored without a vector must
      // still record which model it is destined for — otherwise the sweep would
      // see a hash mismatch and re-chunk it forever.
      embeddingModel: modelId,
      sourceUpdatedAt: draft.sourceUpdatedAt ?? null,
    })));

    return {
      embedded: vectors ? changed.length : 0,
      unchanged,
      removed,
      deferred: vectors ? 0 : changed.length,
    };
  }

  /**
   * Embed the changed chunks, or return null to store them unembedded.
   *
   * Returning null rather than throwing is what makes ingestion survive a
   * missing optional dependency or a half-downloaded model: the content is
   * captured now and becomes searchable when the sweep catches up.
   */
  private async embedOrDefer(drafts: DraftChunk[]): Promise<Float32Array[] | null> {
    try {
      return await this.embeddings.embedPassages(drafts.map((d) => embeddableText(d)));
    } catch (error) {
      this.logger.warn('Deferring embeddings — provider unavailable', {
        chunks: drafts.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Embed rows that were stored without a vector.
   *
   * Returns the number embedded so a caller can loop until it reaches zero. One
   * bounded pass per call rather than draining internally, so a large backlog
   * cannot monopolise the process.
   */
  async sweepPendingEmbeddings(limit = SWEEP_BATCH): Promise<number> {
    const modelId = this.embeddings.id;
    // Passing the active model widens the backlog to rows embedded by a previous
    // one, so switching encoders migrates the index in the background instead of
    // leaving two incomparable vector spaces in the same table.
    const pending = await this.store.listPendingEmbeddings(limit, modelId);
    if (pending.length === 0) return 0;

    const vectors = await this.embeddings.embedPassages(
      pending.map((chunk) => embeddableText({ title: chunk.title, content: chunk.content })),
    );

    await this.store.setEmbeddings(pending.map((chunk, i) => ({
      id: chunk.id,
      embedding: vectors[i]!,
      embeddingModel: modelId,
      // What the vector was computed from. The store refuses the write if the
      // chunk has been re-ingested since, so a vector never lands on text it does
      // not describe.
      expectedContentHash: chunk.contentHash,
      // The hash covers the model id, so re-embedding under a new model has to
      // restate it — otherwise the next ingestion diff would see a mismatch and
      // re-embed this chunk on every event, forever.
      contentHash: hashChunkContent(chunk.content, modelId),
    })));
    return pending.length;
  }

  /**
   * Which sources of a kind the index currently holds.
   *
   * Exposed through the kernel rather than reaching past it to the store, so the
   * backfill keeps talking to one collaborator — the kernel already owns every
   * other read-modify-write on the index.
   */
  async listSourceIds(sourceKind: MemorySourceKind): Promise<string[]> {
    return this.store.listSourceIds(sourceKind);
  }

  /** Forget a source entirely — used when its underlying entity is deleted. */
  async forget(sourceKind: MemorySourceKind, sourceId: string): Promise<void> {
    await this.store.deleteBySource(sourceKind, sourceId);
  }
}
