import { describe, it, expect, vi } from 'vitest';
import { RetrieveContextUseCase } from '../../src/application/use-cases/retrieve-context.js';
import { MemoryChunkEntity } from '../../src/domain/entities/memory-chunk.entity.js';
import type { MemorySearchHit, MemoryStorePort } from '../../src/application/ports/memory-store.port.js';
import type { AppConfig, ConfigPort } from '../../src/application/ports/config.port.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function chunk(sourceId: string, index: number, content: string): MemoryChunkEntity {
  return MemoryChunkEntity.create({
    sourceKind: 'deliverable',
    sourceId,
    chunkIndex: index,
    title: `${sourceId} (${index + 1}/4)`,
    content,
    metadata: {},
    sourceUpdatedAt: new Date('2026-08-01T00:00:00Z'),
  });
}

function hit(c: MemoryChunkEntity, similarity: number): MemorySearchHit {
  return { chunk: c, similarity };
}

function makeConfig(): ConfigPort {
  const cfg = { memoryEngine: 'semantic' } as AppConfig;
  return { get: () => cfg, update: vi.fn(), init: vi.fn() } as unknown as ConfigPort;
}

function makeStore(hits: MemorySearchHit[], whole: Map<string, MemoryChunkEntity[]>) {
  const chunksBySource = vi.fn(async (_kind: string, sourceId: string, limit: number) =>
    (whole.get(sourceId) ?? []).slice(0, limit));
  const store = {
    search: vi.fn(async () => hits),
    searchKeyword: vi.fn(async () => []),
    chunksBySource,
    upsertChunks: vi.fn(), deleteBySource: vi.fn(), deleteBySourceFrom: vi.fn(),
    getHashesBySource: vi.fn(async () => new Map()), listPendingEmbeddings: vi.fn(async () => []),
    setEmbeddings: vi.fn(), getStats: vi.fn(), clear: vi.fn(),
    listSourceIds: vi.fn(async () => []), sampleChunks: vi.fn(async () => []),
  } as unknown as MemoryStorePort;
  return { store, chunksBySource };
}

async function useCase(store: MemoryStorePort) {
  const provider = new FakeEmbeddingProvider();
  await provider.init();
  const summaries = { execute: vi.fn(async () => ({ summaries: [] })) };
  const tickets = { getById: vi.fn(async () => null) };
  return new RetrieveContextUseCase(
    makeConfig(), summaries as never, tickets as never, silent as never, store, provider,
  );
}

/**
 * A question is about a document, not about the two passages of it that matched.
 *
 * Measured on a live corpus: asked for the quarter's OKRs, retrieval returned two
 * of the OKR document's four chunks and the answer covered one of its three
 * objectives. The model cited everything it was given; the other two objectives
 * had never left the index.
 */
describe('search with expandSources', () => {
  const okr = [
    chunk('okr', 0, 'intro to the quarter'),
    chunk('okr', 1, 'Objectif 1 — Traction commerciale'),
    chunk('okr', 2, 'Objectif 2 — Poser les fondations produit'),
    chunk('okr', 3, 'Objectif 3 — Rétention'),
  ];

  it('returns the whole document, not the passages that matched', async () => {
    const { store } = makeStore([hit(okr[1]!, 0.9)], new Map([['okr', okr]]));
    const result = await (await useCase(store)).search({ query: 'les OKR', expandSources: true });

    expect(result).toHaveLength(4);
    // The objectives the capped version never sent.
    expect(result.map((s) => s.content).join('\n')).toContain('Objectif 2');
    expect(result.map((s) => s.content).join('\n')).toContain('Objectif 3');
  });

  it('keeps the document in reading order', async () => {
    const { store } = makeStore([hit(okr[2]!, 0.9)], new Map([['okr', okr]]));
    const result = await (await useCase(store)).search({ query: 'les OKR', expandSources: true });

    expect(result.map((s) => s.content)).toEqual(okr.map((c) => c.content));
  });

  it('leaves a transcript to contribute only what matched', async () => {
    // Ninety chunks of a meeting is a corpus, not a document someone asked about;
    // pasting it would bury the answer it was meant to support.
    const long = Array.from({ length: 90 }, (_, i) => chunk('transcript', i, `line ${i}`));
    const { store } = makeStore([hit(long[10]!, 0.9)], new Map([['transcript', long]]));
    const result = await (await useCase(store)).search({ query: 'anything', expandSources: true });

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('line 10');
  });

  it('does nothing unless asked', async () => {
    const { store, chunksBySource } = makeStore([hit(okr[1]!, 0.9)], new Map([['okr', okr]]));
    const result = await (await useCase(store)).search({ query: 'les OKR' });

    expect(result).toHaveLength(1);
    expect(chunksBySource).not.toHaveBeenCalled();
  });

  it('survives a document read that fails', async () => {
    // Losing the expansion is a smaller loss than losing the search results.
    const { store } = makeStore([hit(okr[1]!, 0.9)], new Map());
    (store.chunksBySource as unknown as { mockRejectedValue: (e: Error) => void })
      .mockRejectedValue(new Error('supabase said no'));

    const result = await (await useCase(store)).search({ query: 'les OKR', expandSources: true });
    expect(result).toHaveLength(1);
  });
});
