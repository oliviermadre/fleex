import { describe, it, expect, vi } from 'vitest';
import { RetrieveContextUseCase } from '../../src/application/use-cases/retrieve-context.js';
import { MemoryChunkEntity } from '../../src/domain/entities/memory-chunk.entity.js';
import type { AppConfig, ConfigPort } from '../../src/application/ports/config.port.js';
import type { EmbeddingProviderPort } from '../../src/application/ports/embedding-provider.port.js';
import type { MemoryStorePort } from '../../src/application/ports/memory-store.port.js';
import type { GetRelevantSummariesUseCase } from '../../src/application/use-cases/get-relevant-summaries.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function config(overrides: Partial<AppConfig>): ConfigPort {
  return { get: () => overrides as AppConfig } as unknown as ConfigPort;
}

function chunk(sourceId: string, title: string) {
  return MemoryChunkEntity.create({
    sourceKind: 'deliverable', sourceId, chunkIndex: 0,
    title, content: `content of ${sourceId}`, metadata: {},
  });
}

function store(overrides: Partial<MemoryStorePort> = {}): MemoryStorePort {
  return {
    upsertChunks: vi.fn(), deleteBySource: vi.fn(), deleteBySourceFrom: vi.fn(),
    listSourceIds: vi.fn(async () => []),
    getHashesBySource: vi.fn(async () => new Map()), refreshMetadata: vi.fn(),
    search: vi.fn(async () => [{ chunk: chunk('s1', 'Session expiry'), similarity: 0.8 }]),
    searchKeyword: vi.fn(async () => []),
    listPendingEmbeddings: vi.fn(async () => []), setEmbeddings: vi.fn(),
    getStats: vi.fn(), clear: vi.fn(),
    ...overrides,
  } as unknown as MemoryStorePort;
}

const provider: EmbeddingProviderPort = {
  id: 'fake:model', dimensions: 4,
  init: async () => {}, isReady: () => true,
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0, 0, 0])),
  embedQuery: async () => new Float32Array([1, 0, 0, 0]),
};

const ticketStore = {
  getTicketById: async () => ({
    id: 't1', title: 'Login times out', description: 'after ten minutes',
    tags: [], boardId: 'b1', links: [],
  }),
} as unknown as TicketStorePort;

const summaries = {
  execute: async () => [{
    ticketId: 't9', ticketTitle: 'Old summary', ticketStatus: 'done',
    content: 'what we did', updatedAt: '2026-01-01T00:00:00Z',
  }],
} as unknown as GetRelevantSummariesUseCase;

describe('shadow mode', () => {
  it('is off by default, so the legacy engine costs exactly what it did before', async () => {
    const memory = store();
    const useCase = new RetrieveContextUseCase(
      config({ memoryEngine: 'legacy' }), summaries, ticketStore, silent as never, memory, provider,
    );

    const result = await useCase.execute({ ticketId: 't1' });

    expect(result.engine).toBe('legacy');
    expect(result.shadowSnippets).toBeUndefined();
    expect(memory.search).not.toHaveBeenCalled();
  });

  it('computes the semantic result without injecting it', async () => {
    const memory = store();
    const useCase = new RetrieveContextUseCase(
      config({ memoryEngine: 'legacy', memoryShadowMode: true }),
      summaries, ticketStore, silent as never, memory, provider,
    );

    const result = await useCase.execute({ ticketId: 't1' });

    // The run still gets the legacy ranking — the shadow is an observation.
    expect(result.engine).toBe('legacy');
    expect(result.summaries).toHaveLength(1);
    expect(result.snippets).toHaveLength(0);
    // And the comparison is there to read.
    expect(result.shadowSnippets?.map((s) => s.sourceId)).toContain('s1');
  });

  it('stays silent when the shadow retrieval fails', async () => {
    const broken = store({ search: vi.fn(async () => { throw new Error('index unavailable'); }) });
    const useCase = new RetrieveContextUseCase(
      config({ memoryEngine: 'legacy', memoryShadowMode: true }),
      summaries, ticketStore, silent as never, broken, provider,
    );

    const result = await useCase.execute({ ticketId: 't1' });

    // An observation that cannot be made must not affect the run it observes.
    expect(result.engine).toBe('legacy');
    expect(result.summaries).toHaveLength(1);
    expect(result.shadowSnippets).toBeUndefined();
  });

  it('does not run twice when the semantic engine is already the live one', async () => {
    const memory = store();
    const useCase = new RetrieveContextUseCase(
      config({ memoryEngine: 'semantic', memoryShadowMode: true }),
      summaries, ticketStore, silent as never, memory, provider,
    );

    const result = await useCase.execute({ ticketId: 't1' });

    expect(result.engine).toBe('semantic');
    expect(result.shadowSnippets).toBeUndefined();
    // One retrieval, not one plus a shadow of itself.
    expect(memory.search).toHaveBeenCalledTimes(1);
  });

  it('needs a store and a provider, not just the setting', async () => {
    const useCase = new RetrieveContextUseCase(
      config({ memoryEngine: 'legacy', memoryShadowMode: true }),
      summaries, ticketStore, silent as never, undefined, undefined,
    );

    const result = await useCase.execute({ ticketId: 't1' });
    expect(result.shadowSnippets).toBeUndefined();
  });
});
