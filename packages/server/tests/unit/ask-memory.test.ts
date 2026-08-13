import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Agent SDK seam so the test never reaches the real API.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { AskMemoryUseCase, buildPrompt } from '../../src/application/use-cases/ask-memory.js';
import type { MemorySnippet, RetrieveContextUseCase } from '../../src/application/use-cases/retrieve-context.js';
import type { SdkConcurrencyLimiter } from '../../src/application/services/sdk-concurrency-limiter.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

/** Make query() yield one result message, as a non-agentic call does. */
function sdkAnswers(result: string) {
  mockedQuery.mockImplementation(async function* () {
    yield { type: 'result', result };
  });
}

function sdkThrows() {
  mockedQuery.mockImplementation(async function* () {
    throw new Error('model unavailable');
    // eslint-disable-next-line no-unreachable
    yield { type: 'result', result: '' };
  });
}

beforeEach(() => {
  mockedQuery.mockReset();
  sdkAnswers('Sessions were chosen over JWT for revocation [1].');
});

/** Records whether the slot was released, so a leak shows up as a failure. */
function makeLimiter(): SdkConcurrencyLimiter & { released: () => number } {
  let released = 0;
  return {
    acquire: async () => () => { released++; },
    released: () => released,
  } as unknown as SdkConcurrencyLimiter & { released: () => number };
}

function snippet(overrides: Partial<MemorySnippet> = {}): MemorySnippet {
  return {
    sourceKind: 'ticket_summary',
    sourceId: 't-old',
    title: 'Old auth work',
    content: 'we chose sessions over JWT because revocation mattered',
    score: 0.9,
    ticketId: 't-old',
    repo: 'org/app',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRetrieve(opts: { enabled?: boolean; results?: MemorySnippet[] } = {}): RetrieveContextUseCase {
  return {
    isSemanticEnabled: () => opts.enabled ?? true,
    search: vi.fn(async () => opts.results ?? []),
  } as unknown as RetrieveContextUseCase;
}

describe('AskMemoryUseCase refuses to answer without evidence', () => {
  it('reports unavailable when the semantic engine is off', async () => {
    const useCase = new AskMemoryUseCase(makeRetrieve({ enabled: false }), makeLimiter(), silent as never);
    const result = await useCase.execute({ question: 'why sessions?' });

    expect(result).toEqual({ answer: null, sources: [], reason: 'unavailable' });
  });

  it('reports no_results rather than answering from nothing', async () => {
    const useCase = new AskMemoryUseCase(makeRetrieve({ results: [] }), makeLimiter(), silent as never);
    const result = await useCase.execute({ question: 'why sessions?' });

    // Answering with no excerpts would be pure invention, which is the one thing
    // a memory tool must never do.
    expect(result.answer).toBeNull();
    expect(result.reason).toBe('no_results');
  });

  it('rejects a blank question without touching retrieval', async () => {
    const retrieve = makeRetrieve();
    const useCase = new AskMemoryUseCase(retrieve, makeLimiter(), silent as never);

    const result = await useCase.execute({ question: '   ' });
    expect(result.reason).toBe('no_results');
    expect(retrieve.search).not.toHaveBeenCalled();
  });

  it('returns the sources even when synthesis fails, so the caller can still show them', async () => {
    sdkThrows();
    const sources = [snippet()];
    const useCase = new AskMemoryUseCase(makeRetrieve({ results: sources }), makeLimiter(), silent as never);

    const result = await useCase.execute({ question: 'why sessions?' });

    expect(result.answer).toBeNull();
    expect(result.reason).toBe('synthesis_failed');
    expect(result.sources).toEqual(sources);
  });

  it('treats an empty model response as a failure rather than an empty answer', async () => {
    sdkAnswers('   ');
    const useCase = new AskMemoryUseCase(makeRetrieve({ results: [snippet()] }), makeLimiter(), silent as never);

    const result = await useCase.execute({ question: 'why sessions?' });
    expect(result.reason).toBe('synthesis_failed');
  });

  it('releases the concurrency slot even when synthesis fails', async () => {
    sdkThrows();
    const limiter = makeLimiter();
    const useCase = new AskMemoryUseCase(makeRetrieve({ results: [snippet()] }), limiter, silent as never);

    await useCase.execute({ question: 'why sessions?' });
    // A leaked slot would silently shrink the global SDK budget for the process.
    expect(limiter.released()).toBe(1);
  });

  it('answers with the retrieved excerpts as its sources', async () => {
    const sources = [snippet()];
    const useCase = new AskMemoryUseCase(makeRetrieve({ results: sources }), makeLimiter(), silent as never);

    const result = await useCase.execute({ question: 'why sessions?' });

    expect(result.answer).toBe('Sessions were chosen over JWT for revocation [1].');
    expect(result.sources).toEqual(sources);
    expect(result.reason).toBeUndefined();
  });

  it('asks for no tools and no agentic turns — it only reads the excerpts', async () => {
    const useCase = new AskMemoryUseCase(makeRetrieve({ results: [snippet()] }), makeLimiter(), silent as never);
    await useCase.execute({ question: 'why sessions?' });

    // Tools would let the model wander off the evidence its citations promise.
    expect(mockedQuery).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ allowedTools: [], maxTurns: 0 }),
    }));
  });

  it('passes the repo filter through to retrieval', async () => {
    const retrieve = makeRetrieve({ results: [snippet()] });
    const useCase = new AskMemoryUseCase(retrieve, makeLimiter(), silent as never);

    await useCase.execute({ question: 'why sessions?', repo: 'org/app', limit: 5 });
    expect(retrieve.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'why sessions?', repo: 'org/app', limit: 5 }),
    );
  });
});

describe('buildPrompt', () => {
  it('numbers excerpts from 1 so citations resolve to the reported order', () => {
    const prompt = buildPrompt('why sessions?', [
      snippet({ title: 'First' }),
      snippet({ title: 'Second' }),
    ]);

    expect(prompt).toContain('[1] First');
    expect(prompt).toContain('[2] Second');
    expect(prompt.indexOf('[1]')).toBeLessThan(prompt.indexOf('[2]'));
  });

  it('labels each excerpt with its origin', () => {
    const prompt = buildPrompt('q', [snippet({ sourceKind: 'comment_thread', repo: 'org/app' })]);
    // The kind is humanised so the model does not echo an internal identifier.
    expect(prompt).toContain('comment thread — org/app — 2026-05-01');
  });

  it('omits unknown origin fields instead of printing placeholders', () => {
    const prompt = buildPrompt('q', [snippet({ repo: null, updatedAt: null })]);
    expect(prompt).toContain('(ticket summary)');
    expect(prompt).not.toContain('null');
  });

  it('states the question and the grounding instruction', () => {
    const prompt = buildPrompt('why sessions?', [snippet()]);
    expect(prompt).toContain('Question: why sessions?');
    expect(prompt).toContain('using only the excerpts above');
  });
});
