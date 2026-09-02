import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Agent SDK seam so no test reaches the real API.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { MemorySynthesiser, NOTHING_SENTINEL, renderEvidence } from '../../src/application/memory/memory-synthesiser.js';
import { CoachPersonaUseCase, buildCoachPrompt } from '../../src/application/use-cases/coach-persona.js';
import { SynthesiseMemoryUseCase, withProvenance } from '../../src/application/use-cases/synthesise-memory.js';
import { RememberConversationUseCase, renderTranscript } from '../../src/application/use-cases/remember-conversation.js';
import { CurateMemoryUseCase } from '../../src/application/use-cases/curate-memory.js';
import { chunkCuratedNote, chunkAssistantDigest, CURATED_TAG } from '../../src/application/memory/chunk-curated.js';
import { HUMAN_FEEDBACK_TAG } from '../../src/application/memory/chunker.js';
import type { MemorySnippet, RetrieveContextUseCase } from '../../src/application/use-cases/retrieve-context.js';
import type { SdkConcurrencyLimiter } from '../../src/application/services/sdk-concurrency-limiter.js';
import type { PersonaStorePort } from '../../src/application/ports/persona-store.port.js';
import type { AgentEventStorePort } from '../../src/application/ports/agent-event-store.port.js';
import type { MemoryKernel } from '../../src/application/memory/memory-kernel.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

function sdkAnswers(result: string) {
  mockedQuery.mockImplementation(async function* () {
    yield { type: 'result', result };
  });
}

let released: number;
function makeLimiter(): SdkConcurrencyLimiter {
  return { acquire: async () => () => { released++; } } as unknown as SdkConcurrencyLimiter;
}

beforeEach(() => {
  released = 0;
  mockedQuery.mockReset();
  sdkAnswers('written output');
});

function snippet(overrides: Partial<MemorySnippet> = {}): MemorySnippet {
  return {
    sourceKind: 'comment_thread',
    sourceId: 't1',
    title: 'Ticket #1: Fix login > discussion',
    content: '**Builder** (agent): I used JWT\n\n**Olivier** (user): no, sessions',
    score: 0.8,
    ticketId: 't1',
    repo: 'org/app',
    updatedAt: '2026-08-01T00:00:00.000Z',
    tags: [HUMAN_FEEDBACK_TAG],
    ...overrides,
  };
}

/** `enabledFeature` is the single feature this stub reports as on. */
function makeRetrieve(opts: { enabledFeature?: string; results?: MemorySnippet[] } = {}): RetrieveContextUseCase {
  return {
    isSemanticEnabled: () => !!opts.enabledFeature,
    isFeatureEnabled: (feature: string) => feature === opts.enabledFeature,
    search: vi.fn(async () => opts.results ?? []),
  } as unknown as RetrieveContextUseCase;
}

describe('MemorySynthesiser', () => {
  it('returns the model prose', async () => {
    sdkAnswers('  a result  ');
    const out = await new MemorySynthesiser(makeLimiter(), silent as never).run({ systemPrompt: 's', userPrompt: 'u' });
    expect(out).toBe('a result');
  });

  it('treats the decline sentinel as no output', async () => {
    sdkAnswers(NOTHING_SENTINEL);
    // A sentinel rather than an empty string, so declining is distinguishable
    // from a failed call at the point where it is produced.
    expect(await new MemorySynthesiser(makeLimiter(), silent as never).run({ systemPrompt: 's', userPrompt: 'u' }))
      .toBeNull();
  });

  it('releases its slot on failure', async () => {
    mockedQuery.mockImplementation(async function* () {
      throw new Error('unavailable');
      // eslint-disable-next-line no-unreachable
      yield { type: 'result', result: '' };
    });
    await new MemorySynthesiser(makeLimiter(), silent as never).run({ systemPrompt: 's', userPrompt: 'u' });
    expect(released).toBe(1);
  });

  it('never grants tools or agentic turns', async () => {
    await new MemorySynthesiser(makeLimiter(), silent as never).run({ systemPrompt: 's', userPrompt: 'u' });
    expect(mockedQuery).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ allowedTools: [], maxTurns: 0 }),
    }));
  });
});

describe('renderEvidence', () => {
  it('numbers excerpts from 1 and labels their origin', () => {
    const rendered = renderEvidence([snippet({ title: 'First' }), snippet({ title: 'Second' })]);
    expect(rendered).toContain('[1] First');
    expect(rendered).toContain('[2] Second');
    expect(rendered).toContain('comment thread — org/app — 2026-08-01');
  });
});

// ─── Persona coach ───

function makePersonaStore(persona: { id: string; name: string; memoryMd: string } | null) {
  const saved: string[] = [];
  const store = {
    getById: async () => persona
      ? { ...persona, update: (c: { memoryMd?: string }) => { if (c.memoryMd) saved.push(c.memoryMd); } }
      : null,
    save: vi.fn(async () => {}),
  } as unknown as PersonaStorePort;
  return { store, saved };
}

describe('CoachPersonaUseCase', () => {
  const persona = { id: 'p1', name: 'Builder', memoryMd: '- prefer sessions' };

  it('reports unavailable when the feature is off', async () => {
    const { store } = makePersonaStore(persona);
    const coach = new CoachPersonaUseCase(store, makeRetrieve(), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);
    expect((await coach.propose('p1')).reason).toBe('unavailable');
  });

  it('reports not_found for an unknown agent', async () => {
    const { store } = makePersonaStore(null);
    const coach = new CoachPersonaUseCase(store, makeRetrieve({ enabledFeature: 'personaCoach' }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);
    expect((await coach.propose('nope')).reason).toBe('not_found');
  });

  it('reports no_evidence rather than inventing lessons', async () => {
    const { store } = makePersonaStore(persona);
    const coach = new CoachPersonaUseCase(store, makeRetrieve({ enabledFeature: 'personaCoach', results: [] }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);
    const proposal = await coach.propose('p1');
    expect(proposal.reason).toBe('no_evidence');
    expect(proposal.proposedMemoryMd).toBeNull();
  });

  it('ignores threads that carry no correction', async () => {
    // An ordinary discussion the agent took part in teaches it nothing.
    const plain = snippet({ tags: [] });
    const { store } = makePersonaStore(persona);
    const coach = new CoachPersonaUseCase(store, makeRetrieve({ enabledFeature: 'personaCoach', results: [plain] }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);
    expect((await coach.propose('p1')).reason).toBe('no_evidence');
  });

  it('proposes a replacement and keeps the current text for comparison', async () => {
    sdkAnswers('- prefer sessions\n- never use JWT: we need revocation');
    const { store } = makePersonaStore(persona);
    const coach = new CoachPersonaUseCase(store, makeRetrieve({ enabledFeature: 'personaCoach', results: [snippet()] }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);

    const proposal = await coach.propose('p1');
    expect(proposal.proposedMemoryMd).toContain('never use JWT');
    expect(proposal.currentMemoryMd).toBe('- prefer sessions');
    expect(proposal.evidence).toHaveLength(1);
  });

  it('reports nothing_to_learn when the proposal matches the current text', async () => {
    sdkAnswers('- prefer sessions');
    const { store } = makePersonaStore(persona);
    const coach = new CoachPersonaUseCase(store, makeRetrieve({ enabledFeature: 'personaCoach', results: [snippet()] }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);
    expect((await coach.propose('p1')).reason).toBe('nothing_to_learn');
  });

  it('applies the reviewed text rather than regenerating it', async () => {
    const { store, saved } = makePersonaStore(persona);
    const coach = new CoachPersonaUseCase(store, makeRetrieve({ enabledFeature: 'personaCoach' }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);

    expect(await coach.apply('p1', '- the reviewed text')).toBe(true);
    expect(saved).toEqual(['- the reviewed text']);
    // No model call: applying a fresh proposal would write something unread.
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('states an empty memory explicitly in the prompt', () => {
    // "(empty)" reads as a fresh start; a blank section reads as a truncated prompt.
    expect(buildCoachPrompt('Builder', '', [snippet()])).toContain('has learned nothing yet');
  });
});

// ─── Cross-document synthesis ───

describe('SynthesiseMemoryUseCase', () => {
  it('reports unavailable when the feature is off', async () => {
    const useCase = new SynthesiseMemoryUseCase(makeRetrieve(), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);
    expect((await useCase.execute({ subject: 'auth' })).reason).toBe('unavailable');
  });

  it('reports no_results rather than compiling from nothing', async () => {
    const useCase = new SynthesiseMemoryUseCase(makeRetrieve({ enabledFeature: 'synthesis', results: [] }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);
    expect((await useCase.execute({ subject: 'auth' })).reason).toBe('no_results');
  });

  it('compiles a document and reports its sources', async () => {
    sdkAnswers('## Themes\nSessions were chosen [1].');
    const useCase = new SynthesiseMemoryUseCase(makeRetrieve({ enabledFeature: 'synthesis', results: [snippet()] }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never);

    const result = await useCase.execute({ subject: 'auth' });
    expect(result.document).toContain('Sessions were chosen [1]');
    expect(result.sources).toHaveLength(1);
    expect(result.deliverableId).toBeUndefined();
  });

  it('saves to a ticket only when asked', async () => {
    sdkAnswers('a document');
    const submit = { execute: vi.fn(async () => ({ id: 'd-new' })) } as never;
    const useCase = new SynthesiseMemoryUseCase(
      makeRetrieve({ enabledFeature: 'synthesis', results: [snippet()] }),
      new MemorySynthesiser(makeLimiter(), silent as never), silent as never, submit,
    );

    const result = await useCase.execute({ subject: 'auth', saveToTicketId: 't9' });
    expect(result.deliverableId).toBe('d-new');
  });

  it('keeps the document when filing it fails', async () => {
    sdkAnswers('a document');
    const failing = { execute: vi.fn(async () => { throw new Error('no such ticket'); }) } as never;
    const useCase = new SynthesiseMemoryUseCase(
      makeRetrieve({ enabledFeature: 'synthesis', results: [snippet()] }),
      new MemorySynthesiser(makeLimiter(), silent as never), silent as never, failing,
    );

    const result = await useCase.execute({ subject: 'auth', saveToTicketId: 't9' });
    // The document *is* the deliverable; failing to file it must not lose it.
    expect(result.document).toBe('a document');
    expect(result.deliverableId).toBeUndefined();
  });
});

describe('withProvenance', () => {
  it('appends a source list so saved citations still resolve', () => {
    const out = withProvenance('body [1]', [snippet({ title: 'Old auth work' })]);
    expect(out).toContain('## Sources');
    expect(out).toContain('- [1] Old auth work');
  });
});

// ─── Curation ───

function makeKernel() {
  const ingested: Array<{ kind: string; id: string; chunks: number }> = [];
  const kernel = {
    ingest: vi.fn(async (kind: string, id: string, drafts: unknown[]) => {
      ingested.push({ kind, id, chunks: drafts.length });
      return { embedded: drafts.length, unchanged: 0, removed: 0, deferred: 0 };
    }),
    forget: vi.fn(async () => {}),
  } as unknown as MemoryKernel;
  return { kernel, ingested };
}

function makeEventStore(texts: string[]): AgentEventStorePort {
  return {
    getEventsByExecution: async () => texts.map((text, i) => ({
      id: `e${i}`,
      executionId: 'x1',
      eventType: 'content_block_delta',
      data: { type: 'assistant', message: { content: [{ type: 'text', text }] } },
      sequence: i,
      createdAt: new Date(),
    })),
  } as unknown as AgentEventStorePort;
}

describe('CurateMemoryUseCase', () => {
  it('reports unavailable when the feature is off', async () => {
    const { kernel } = makeKernel();
    const useCase = new CurateMemoryUseCase(makeEventStore([]), makeRetrieve(), silent as never, kernel);
    expect((await useCase.curate({ executionId: 'x1' })).reason).toBe('unavailable');
  });

  it('saves the selected text as a curated note', async () => {
    const { kernel, ingested } = makeKernel();
    const useCase = new CurateMemoryUseCase(makeEventStore([]), makeRetrieve({ enabledFeature: 'curation' }), silent as never, kernel);

    const result = await useCase.curate({ executionId: 'x1', content: 'the CI needs docker on arm', comment: 'remember this' });
    expect(result.ok).toBe(true);
    expect(ingested[0]).toMatchObject({ kind: 'curated_note' });
  });

  it('distils the run own words when no selection is given', async () => {
    const { kernel } = makeKernel();
    const useCase = new CurateMemoryUseCase(
      makeEventStore(['first thought', 'second thought']),
      makeRetrieve({ enabledFeature: 'curation' }), silent as never, kernel,
    );

    expect((await useCase.curate({ executionId: 'x1' })).ok).toBe(true);
  });

  it('reports empty when the run produced no text', async () => {
    const { kernel } = makeKernel();
    const useCase = new CurateMemoryUseCase(makeEventStore([]), makeRetrieve({ enabledFeature: 'curation' }), silent as never, kernel);
    expect((await useCase.curate({ executionId: 'x1' })).reason).toBe('empty');
  });
});

describe('chunkCuratedNote', () => {
  it('leads with the user comment, which is why the note was kept', () => {
    const [chunk] = chunkCuratedNote({ id: 'n1', title: 'Note', content: 'the body', comment: 'the reason' });
    expect(chunk?.content.startsWith('the reason')).toBe(true);
  });

  it('tags the note as curated so the act of keeping it counts', () => {
    const [chunk] = chunkCuratedNote({ id: 'n1', title: 'Note', content: 'body' });
    expect(chunk?.metadata.tags).toContain(CURATED_TAG);
  });

  it('produces nothing for an empty note', () => {
    expect(chunkCuratedNote({ id: 'n1', title: 'Note', content: '   ' })).toEqual([]);
  });
});

// ─── Assistant memory ───

describe('RememberConversationUseCase', () => {
  const turns = [
    { role: 'user' as const, content: 'always branch off develop' },
    { role: 'assistant' as const, content: 'noted' },
  ];

  it('reports unavailable when the feature is off', async () => {
    const { kernel } = makeKernel();
    const useCase = new RememberConversationUseCase(makeRetrieve(), new MemorySynthesiser(makeLimiter(), silent as never), silent as never, kernel);
    expect((await useCase.execute({ conversationId: 'c1', turns })).reason).toBe('unavailable');
  });

  it('indexes the digest keyed on the conversation', async () => {
    sdkAnswers('- always branch off develop');
    const { kernel, ingested } = makeKernel();
    const useCase = new RememberConversationUseCase(makeRetrieve({ enabledFeature: 'assistantMemory' }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never, kernel);

    const result = await useCase.execute({ conversationId: 'c1', title: 'Branching', turns });
    expect(result.ok).toBe(true);
    // Keyed on the conversation, so re-distilling replaces rather than accumulates.
    expect(ingested[0]).toMatchObject({ kind: 'assistant_conversation', id: 'c1' });
  });

  it('keeps nothing when the conversation established nothing durable', async () => {
    sdkAnswers(NOTHING_SENTINEL);
    const { kernel, ingested } = makeKernel();
    const useCase = new RememberConversationUseCase(makeRetrieve({ enabledFeature: 'assistantMemory' }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never, kernel);

    expect((await useCase.execute({ conversationId: 'c1', turns })).reason).toBe('nothing_to_remember');
    // Replacing a previous digest with nothing would also be wrong.
    expect(ingested).toEqual([]);
  });

  it('reports empty for a conversation with no content', async () => {
    const { kernel } = makeKernel();
    const useCase = new RememberConversationUseCase(makeRetrieve({ enabledFeature: 'assistantMemory' }), new MemorySynthesiser(makeLimiter(), silent as never), silent as never, kernel);
    expect((await useCase.execute({ conversationId: 'c1', turns: [{ role: 'user', content: '  ' }] })).reason)
      .toBe('empty');
  });
});

describe('renderTranscript', () => {
  it('labels each turn by role', () => {
    expect(renderTranscript([{ role: 'user', content: 'hello' }])).toBe('**user**: hello');
  });

  it('drops blank turns', () => {
    expect(renderTranscript([{ role: 'user', content: '  ' }])).toBe('');
  });

  it('keeps the end of a long conversation, where conclusions land', () => {
    const long = [
      { role: 'user' as const, content: 'x'.repeat(40_000) },
      { role: 'assistant' as const, content: 'THE CONCLUSION' },
    ];
    const rendered = renderTranscript(long);
    expect(rendered).toContain('THE CONCLUSION');
    expect(rendered).toContain('earlier turns omitted');
  });
});

describe('chunkAssistantDigest', () => {
  it('prefixes the title so a digest is recognisable in results', () => {
    const [chunk] = chunkAssistantDigest({ conversationId: 'c1', title: 'Branching', content: '- rule' });
    expect(chunk?.title).toBe('Assistant: Branching');
  });

  it('produces nothing for an empty digest', () => {
    expect(chunkAssistantDigest({ conversationId: 'c1', title: 't', content: '' })).toEqual([]);
  });
});
