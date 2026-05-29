import { describe, it, expect, beforeEach } from 'vitest';
import { ProcessSessionEndUseCase } from '../../src/application/use-cases/process-session-end.js';
import type { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { AgentEventStorePort } from '../../src/application/ports/agent-event-store.port.js';
import type { ClaudeStatePort } from '../../src/application/ports/claude-state.port.js';
import type { SessionSummarizerPort } from '../../src/application/ports/session-summarizer.port.js';
import type { SubmitDeliverableUseCase } from '../../src/application/use-cases/submit-deliverable.js';
import { FakeLoggerPort, FakeHostFs } from '../helpers/fakes.js';

const TRANSCRIPT = [
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'do it' }, timestamp: '2026-05-29T10:00:00Z' }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-05-29T10:00:08Z',
    message: { role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: 120, output_tokens: 40 } },
  }),
].join('\n');

describe('ProcessSessionEndUseCase', () => {
  let resolver: { manifest: { ticketId: string } | null } & RepoPathResolver;
  let ticketStore: TicketStorePort;
  let agentEvents: { started: unknown[]; completed: unknown[] } & AgentEventStorePort;
  let claudeState: ClaudeStatePort;
  let summarizer: { result: string | null } & SessionSummarizerPort;
  let deliverables: { submitted: unknown[] } & SubmitDeliverableUseCase;
  let hostFs: FakeHostFs;
  let logger: FakeLoggerPort;
  let useCase: ProcessSessionEndUseCase;

  const TICKET = { id: 'tk-1', title: 'Fix the cache' };

  beforeEach(() => {
    resolver = {
      manifest: { ticketId: 'tk-1' },
      resolveManifest() { return this.manifest; },
    } as unknown as typeof resolver;

    ticketStore = {
      async getTicketById(id: string) {
        return id === TICKET.id ? (TICKET as never) : null;
      },
    } as unknown as TicketStorePort;

    agentEvents = {
      started: [],
      completed: [],
      async startExecution(p: unknown) { (this as typeof agentEvents).started.push(p); },
      async completeExecution(id: string, status: string, metrics: unknown) {
        (this as typeof agentEvents).completed.push({ id, status, metrics });
      },
    } as unknown as typeof agentEvents;

    claudeState = {
      async findSessionFile() { return null; },
    } as unknown as ClaudeStatePort;

    summarizer = {
      result: 'Key decision: bust the cache on write.',
      async summarize() { return (this as typeof summarizer).result; },
    } as unknown as typeof summarizer;

    deliverables = {
      submitted: [],
      async execute(p: unknown) { (this as typeof deliverables).submitted.push(p); return {} as never; },
    } as unknown as typeof deliverables;

    hostFs = new FakeHostFs();
    logger = new FakeLoggerPort();

    useCase = new ProcessSessionEndUseCase(
      resolver, ticketStore, agentEvents, claudeState, summarizer, deliverables, hostFs, logger,
    );
  });

  it('records manual usage and a summary deliverable on the happy path', async () => {
    hostFs.addExistingPath('/t/transcript.jsonl');
    await hostFs.writeFile('/t/transcript.jsonl', TRANSCRIPT);

    const res = await useCase.execute({
      cwd: '/ws/tk-1/repo',
      transcriptPath: '/t/transcript.jsonl',
      claudeSessionId: 'sess-abc',
    });

    expect(res.recorded).toBe(true);
    expect(res.ticketId).toBe('tk-1');
    expect(res.summarized).toBe(true);

    expect(agentEvents.started).toHaveLength(1);
    expect(agentEvents.started[0]).toMatchObject({
      personaId: 'manual',
      ticketId: 'tk-1',
      mentionId: 'manual:sess-abc',
      source: 'manual',
    });
    expect(agentEvents.completed[0]).toMatchObject({
      status: 'completed',
      metrics: { inputTokens: 120, outputTokens: 40, model: 'claude-opus-4-8' },
    });

    expect(deliverables.submitted).toHaveLength(1);
    expect(deliverables.submitted[0]).toMatchObject({
      ticketId: 'tk-1',
      type: 'ticket-summary',
      status: 'final',
    });
  });

  it('skips when cwd is not inside a ticket workspace', async () => {
    resolver.manifest = null;
    const res = await useCase.execute({ cwd: '/elsewhere', transcriptPath: '/t/transcript.jsonl', claudeSessionId: null });
    expect(res).toEqual({ recorded: false, reason: 'no-ticket' });
    expect(agentEvents.started).toHaveLength(0);
  });

  it('skips when the transcript cannot be read', async () => {
    const res = await useCase.execute({ cwd: '/ws/tk-1', transcriptPath: '/missing.jsonl', claudeSessionId: null });
    expect(res).toMatchObject({ recorded: false, reason: 'no-transcript', ticketId: 'tk-1' });
  });

  it('still records usage when summarization yields nothing', async () => {
    summarizer.result = null;
    hostFs.addExistingPath('/t/transcript.jsonl');
    await hostFs.writeFile('/t/transcript.jsonl', TRANSCRIPT);

    const res = await useCase.execute({ cwd: '/ws/tk-1', transcriptPath: '/t/transcript.jsonl', claudeSessionId: null });

    expect(res.recorded).toBe(true);
    expect(res.summarized).toBe(false);
    expect(agentEvents.started).toHaveLength(1);
    expect(deliverables.submitted).toHaveLength(0);
  });

  it('falls back to findSessionFile when no transcript path is given', async () => {
    hostFs.addExistingPath('/found/session.jsonl');
    await hostFs.writeFile('/found/session.jsonl', TRANSCRIPT);
    claudeState = {
      async findSessionFile() { return { path: '/found/session.jsonl', ageSeconds: 1 }; },
    } as unknown as ClaudeStatePort;
    useCase = new ProcessSessionEndUseCase(
      resolver, ticketStore, agentEvents, claudeState, summarizer, deliverables, hostFs, logger,
    );

    const res = await useCase.execute({ cwd: '/ws/tk-1', transcriptPath: null, claudeSessionId: null });
    expect(res.recorded).toBe(true);
    expect(agentEvents.started).toHaveLength(1);
  });
});
