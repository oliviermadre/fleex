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

/**
 * The exact-match pass, and what it must never cost.
 *
 * A leading-wildcard substring search reads the whole table. Warm it took 500 ms;
 * cold, Postgres cancelled the statement and the whole request became a 500 —
 * even though vector search had already succeeded. And the query that triggered
 * it, "les routines c'est quoi ?", could never have matched a literal anyway.
 */
describe('the keyword pass', () => {
  const doc = chunk('doc', 0, 'body');

  function store(keyword: { hits?: MemoryChunkEntity[]; fails?: boolean }) {
    const searchKeyword = keyword.fails
      ? vi.fn(async () => { throw new Error('canceling statement due to statement timeout'); })
      : vi.fn(async () => keyword.hits ?? []);
    return {
      s: {
        search: vi.fn(async () => [hit(doc, 0.5)]),
        searchKeyword,
        chunksBySource: vi.fn(async () => []),
        upsertChunks: vi.fn(), deleteBySource: vi.fn(), deleteBySourceFrom: vi.fn(),
        getHashesBySource: vi.fn(async () => new Map()), listPendingEmbeddings: vi.fn(async () => []),
        setEmbeddings: vi.fn(), getStats: vi.fn(), clear: vi.fn(),
        listSourceIds: vi.fn(async () => []), sampleChunks: vi.fn(async () => []),
      } as unknown as MemoryStorePort,
      searchKeyword,
    };
  }

  it('runs for a single token, which is what an identifier looks like', async () => {
    const { s, searchKeyword } = store({});
    await (await useCase(s)).search({ query: 'ERR_CONN_RESET' });
    expect(searchKeyword).toHaveBeenCalled();
  });

  it('is skipped for a question asked in prose', async () => {
    // No document contains that literal string, so the table scan was guaranteed
    // to return nothing.
    const { s, searchKeyword } = store({});
    await (await useCase(s)).search({ query: "les routines c'est quoi ?" });
    expect(searchKeyword).not.toHaveBeenCalled();
  });

  it('still returns the vector results when it fails', async () => {
    // The regression that mattered: an optional enrichment turned a good answer
    // into a 500.
    const { s } = store({ fails: true });
    const result = await (await useCase(s)).search({ query: 'ERR_CONN_RESET' });
    expect(result).toHaveLength(1);
  });

  it('contributes a hit the vector pass missed', async () => {
    // The reason it exists: a rare literal is what embeddings blur away.
    const literal = chunk('other', 0, 'record recBAjhy9RgPu1tFx absent');
    const { s } = store({ hits: [literal] });
    const result = await (await useCase(s)).search({ query: 'recBAjhy9RgPu1tFx' });
    expect(result.map((r) => r.sourceId)).toContain('other');
  });
});
