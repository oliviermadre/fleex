import { describe, it, expect, vi } from 'vitest';
import { RetrieveContextUseCase } from '../../src/application/use-cases/retrieve-context.js';
import { MemoryChunkEntity } from '../../src/domain/entities/memory-chunk.entity.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import type { AppConfig, ConfigPort } from '../../src/application/ports/config.port.js';
import type { MemorySearchHit, MemoryStorePort } from '../../src/application/ports/memory-store.port.js';
import type { GetRelevantSummariesUseCase } from '../../src/application/use-cases/get-relevant-summaries.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const LEGACY_SUMMARIES = [
  {
    ticketId: 't-old',
    ticketTitle: 'Old auth work',
    ticketStatus: 'done' as const,
    content: 'we chose sessions over JWT',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
];

function makeConfig(overrides: Partial<AppConfig> = {}): ConfigPort {
  const value = { basePath: '/tmp', defaultShell: 'bash', repositoryRefreshIntervalMs: 0, ...overrides } as AppConfig;
  return {
    init: async () => {},
    get: () => value,
    update: () => {},
    getClaudeCommand: () => 'claude',
  };
}

function makeTicketStore(ticket: Partial<{ id: string; title: string; description: string; tags: string[]; boardId: string }> = {}): TicketStorePort {
  return {
    getTicketById: async () => ({
      id: 't1', title: 'Fix login session expiry', description: 'sessions expire too early',
      tags: ['auth'], boardId: 'b1', ...ticket,
    }),
  } as unknown as TicketStorePort;
}

function makeSummaries(result = LEGACY_SUMMARIES): GetRelevantSummariesUseCase {
  return { execute: vi.fn(async () => result) } as unknown as GetRelevantSummariesUseCase;
}

function chunkHit(params: {
  sourceKind?: 'ticket_summary' | 'deliverable' | 'scratchpad';
  sourceId: string;
  title?: string;
  content: string;
  ticketId?: string | null;
  similarity: number;
}): MemorySearchHit {
  return {
    chunk: MemoryChunkEntity.create({
      sourceKind: params.sourceKind ?? 'deliverable',
      sourceId: params.sourceId,
      chunkIndex: 0,
      title: params.title ?? params.sourceId,
      content: params.content,
      metadata: { ticketId: params.ticketId ?? null },
      sourceUpdatedAt: new Date('2026-08-01T00:00:00Z'),
    }),
    similarity: params.similarity,
  };
}

function makeMemoryStore(hits: MemorySearchHit[]): MemoryStorePort {
  return {
    search: vi.fn(async () => hits),
    searchKeyword: vi.fn(async () => []),
    upsertChunks: vi.fn(), deleteBySource: vi.fn(), deleteBySourceFrom: vi.fn(),
    getHashesBySource: vi.fn(async () => new Map()), listPendingEmbeddings: vi.fn(async () => []),
    setEmbeddings: vi.fn(), getStats: vi.fn(), clear: vi.fn(),
  } as unknown as MemoryStorePort;
}

async function semanticUseCase(hits: MemorySearchHit[], config = makeConfig({ memoryEngine: 'semantic' })) {
  const provider = new FakeEmbeddingProvider();
  await provider.init();
  return new RetrieveContextUseCase(
    config, makeSummaries(), makeTicketStore(), silent as never, makeMemoryStore(hits), provider,
  );
}

describe('engine selection defaults to legacy', () => {
  it('uses the legacy ranking when memoryEngine is unset', async () => {
    const legacy = makeSummaries();
    const useCase = new RetrieveContextUseCase(makeConfig(), legacy, makeTicketStore(), silent as never);

    const result = await useCase.execute({ ticketId: 't1' });

    expect(result.engine).toBe('legacy');
    // Bit-for-bit what the previous implementation returned — the whole point of
    // shipping the new engine behind a switch.
    expect(result.summaries).toEqual(LEGACY_SUMMARIES);
    expect(result.snippets).toEqual([]);
    expect(legacy.execute).toHaveBeenCalledWith({ ticketId: 't1' });
  });

  it('stays on legacy when explicitly configured, even with an index available', async () => {
    const legacy = makeSummaries();
    const useCase = new RetrieveContextUseCase(
      makeConfig({ memoryEngine: 'legacy' }), legacy, makeTicketStore(), silent as never,
      makeMemoryStore([chunkHit({ sourceId: 'd1', content: 'anything', similarity: 0.9 })]),
      new FakeEmbeddingProvider(),
    );

    const result = await useCase.execute({ ticketId: 't1' });
    expect(result.engine).toBe('legacy');
    expect(result.snippets).toEqual([]);
  });

  it('reports the semantic engine as disabled without a store or provider', async () => {
    const useCase = new RetrieveContextUseCase(
      makeConfig({ memoryEngine: 'semantic' }), makeSummaries(), makeTicketStore(), silent as never,
    );
    expect(useCase.isSemanticEnabled()).toBe(false);

    // Opting in on a driver with no index must not starve the prompt.
    const result = await useCase.execute({ ticketId: 't1' });
    expect(result.engine).toBe('legacy');
    expect(result.summaries).toEqual(LEGACY_SUMMARIES);
  });

  it('returns no summaries when there is no ticket to anchor on', async () => {
    const useCase = new RetrieveContextUseCase(makeConfig(), makeSummaries(), makeTicketStore(), silent as never);
    const result = await useCase.execute({});
    expect(result).toEqual({ engine: 'legacy', summaries: [], snippets: [] });
  });

  it('survives a failing legacy ranking rather than failing the run', async () => {
    const throwing = { execute: vi.fn(async () => { throw new Error('db down'); }) } as unknown as GetRelevantSummariesUseCase;
    const useCase = new RetrieveContextUseCase(makeConfig(), throwing, makeTicketStore(), silent as never);
    await expect(useCase.execute({ ticketId: 't1' })).resolves.toEqual({
      engine: 'legacy', summaries: [], snippets: [],
    });
  });
});

describe('semantic engine', () => {
  it('splits hits into legacy-shaped summaries and other snippets', async () => {
    const useCase = await semanticUseCase([
      chunkHit({ sourceKind: 'ticket_summary', sourceId: 's1', title: 'Old auth work', content: 'chose sessions', ticketId: 't-old', similarity: 0.9 }),
      chunkHit({ sourceKind: 'scratchpad', sourceId: 'n1', title: 'Scratchpad: org/app', content: 'watch the migration order', similarity: 0.8 }),
    ]);

    const result = await useCase.execute({ ticketId: 't1' });

    expect(result.engine).toBe('semantic');
    // The existing prompt section keeps its shape, fed by the new engine.
    expect(result.summaries).toEqual([{
      ticketId: 't-old',
      ticketTitle: 'Old auth work',
      ticketStatus: 'done',
      content: 'chose sessions',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }]);
    expect(result.snippets.map((s) => s.sourceId)).toEqual(['n1']);
  });

  it('exposes the score that selected each snippet', async () => {
    const useCase = await semanticUseCase([
      chunkHit({ sourceId: 'd1', content: 'relevant content', similarity: 0.9 }),
    ]);
    const result = await useCase.execute({ ticketId: 't1' });
    expect(result.snippets[0]!.score).toBeGreaterThan(0);
    expect(result.snippets[0]!.score).toBeLessThanOrEqual(1);
  });

  it('honours the character budget', async () => {
    const useCase = await semanticUseCase(
      [
        chunkHit({ sourceId: 'big', content: 'x'.repeat(400), similarity: 0.95 }),
        chunkHit({ sourceId: 'small', content: 'y'.repeat(50), similarity: 0.90 }),
      ],
      makeConfig({ memoryEngine: 'semantic', memoryInjectionCharBudget: 100 }),
    );

    const result = await useCase.execute({ ticketId: 't1' });
    // The 400-char chunk does not fit; the 50-char one does.
    expect(result.snippets.map((s) => s.sourceId)).toEqual(['small']);
  });

  it('falls back to legacy when the index yields nothing', async () => {
    const useCase = await semanticUseCase([]);
    const result = await useCase.execute({ ticketId: 't1' });
    expect(result.engine).toBe('legacy');
    expect(result.summaries).toEqual(LEGACY_SUMMARIES);
  });

  it('falls back to legacy when retrieval throws', async () => {
    const provider = new FakeEmbeddingProvider();
    await provider.init();
    const broken = {
      ...makeMemoryStore([]),
      search: vi.fn(async () => { throw new Error('index corrupt'); }),
    } as unknown as MemoryStorePort;

    const useCase = new RetrieveContextUseCase(
      makeConfig({ memoryEngine: 'semantic' }), makeSummaries(), makeTicketStore(), silent as never, broken, provider,
    );

    const result = await useCase.execute({ ticketId: 't1' });
    expect(result.engine).toBe('legacy');
    expect(result.summaries).toEqual(LEGACY_SUMMARIES);
  });

  it('returns nothing when neither a query nor ticket text is available', async () => {
    const provider = new FakeEmbeddingProvider();
    await provider.init();
    const emptyTicket = { getTicketById: async () => ({ id: 't1', title: '', description: '', tags: [], boardId: null }) } as unknown as TicketStorePort;
    const useCase = new RetrieveContextUseCase(
      makeConfig({ memoryEngine: 'semantic' }), makeSummaries([]), emptyTicket, silent as never,
      makeMemoryStore([]), provider,
    );

    const result = await useCase.execute({ ticketId: 't1' });
    // Empty on both sides means fallback, and the fallback here has nothing either.
    expect(result.summaries).toEqual([]);
    expect(result.snippets).toEqual([]);
  });

  it('excludes the anchor ticket own content from its own prompt', async () => {
    const provider = new FakeEmbeddingProvider();
    await provider.init();
    const store = makeMemoryStore([chunkHit({ sourceId: 'd1', content: 'something', similarity: 0.9 })]);
    const useCase = new RetrieveContextUseCase(
      makeConfig({ memoryEngine: 'semantic' }), makeSummaries(), makeTicketStore(), silent as never, store, provider,
    );

    await useCase.execute({ ticketId: 't1' });
    expect(store.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ excludeTicketId: 't1' }),
      expect.any(Number),
    );
  });

  it('over-fetches candidates so ranking has room to re-order and de-duplicate', async () => {
    const provider = new FakeEmbeddingProvider();
    await provider.init();
    const store = makeMemoryStore([]);
    const useCase = new RetrieveContextUseCase(
      makeConfig({ memoryEngine: 'semantic' }), makeSummaries(), makeTicketStore(), silent as never, store, provider,
    );

    await useCase.execute({ ticketId: 't1', limit: 5 });
    expect(store.search).toHaveBeenCalledWith(expect.anything(), expect.anything(), 20);
  });

  it('passes a repo filter through to the store', async () => {
    const provider = new FakeEmbeddingProvider();
    await provider.init();
    const store = makeMemoryStore([]);
    const useCase = new RetrieveContextUseCase(
      makeConfig({ memoryEngine: 'semantic' }), makeSummaries(), makeTicketStore(), silent as never, store, provider,
    );

    await useCase.execute({ ticketId: 't1', repo: 'org/app' });
    expect(store.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repo: 'org/app' }),
      expect.any(Number),
    );
  });
});
