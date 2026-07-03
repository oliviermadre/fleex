import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the Agent SDK seam so the test never touches the real Claude Agent SDK.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { CLI_SESSION_SUMMARY_TYPE } from '@fleex/shared';
import {
  GenerateCliSessionSummaryUseCase,
  buildSessionPrompt,
  MAX_TURN_CHARS,
  MAX_TRANSCRIPT_CHARS,
} from '../../src/application/use-cases/generate-cli-session-summary.js';
import type { TranscriptTurn } from '../../src/application/utils/cli-session-ingest.js';
import { SdkConcurrencyLimiter } from '../../src/application/services/sdk-concurrency-limiter.js';
import { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';
import type { DeliverableStorePort } from '../../src/application/ports/deliverable-store.port.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

/** Make query() return an async iterable that yields a single result message. */
function sdkResult(result: string) {
  mockedQuery.mockImplementation(async function* () {
    yield { type: 'result', result };
  });
}

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as LoggerPort;
const TICKET_ID = 'tkt-1';
let dir: string;

function writeJsonl(path: string, objects: unknown[]) {
  writeFileSync(path, objects.map((o) => JSON.stringify(o)).join('\n') + '\n');
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fleex-cli-summary-'));
  writeJsonl(join(dir, 'ok.jsonl'), [
    { type: 'user', timestamp: '2026-07-03T10:00:00Z', message: { role: 'user', content: 'Refactor the parser' } },
    { type: 'assistant', timestamp: '2026-07-03T10:00:05Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Chose approach A over B for perf.' }] } },
  ]);
  // Only tool noise → no assistant text to summarize.
  writeJsonl(join(dir, 'empty.jsonl'), [
    { type: 'user', timestamp: '2026-07-03T10:00:00Z', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', timestamp: '2026-07-03T10:00:01Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } },
  ]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeStore(existing: TicketDeliverableEntity[] = []) {
  const saved: TicketDeliverableEntity[] = [...existing];
  const store = {
    getByTicket: vi.fn(async (tid: string) => saved.filter((d) => d.ticketId === tid)),
    save: vi.fn(async (d: TicketDeliverableEntity) => { saved.push(d); }),
  } as unknown as DeliverableStorePort;
  return { store, saved };
}

function makeUseCase(store: DeliverableStorePort) {
  const events: AnyDomainEvent[] = [];
  const useCase = new GenerateCliSessionSummaryUseCase(store, logger, new SdkConcurrencyLimiter(() => 10));
  useCase.eventBus = { emit: (...e: AnyDomainEvent[]) => events.push(...e) } as never;
  return { useCase, events };
}

beforeEach(() => { mockedQuery.mockReset(); });

describe('GenerateCliSessionSummaryUseCase', () => {
  it('creates a cli-session-summary deliverable from the transcript (AC1)', async () => {
    sdkResult('## CLI session\n\n### What was done\nRefactored the parser.');
    const { store, saved } = makeStore();
    const { useCase, events } = makeUseCase(store);

    await useCase.execute({ sessionId: 'sess1', ticketId: TICKET_ID, transcriptPath: join(dir, 'ok.jsonl') });

    expect(saved).toHaveLength(1);
    const d = saved[0]!;
    expect(d.type).toBe(CLI_SESSION_SUMMARY_TYPE);
    expect(d.status).toBe('final');
    expect(d.agentName).toBe('system');
    expect(d.mentionId).toBe('cli:sess1');
    expect(d.content).toContain('Refactored the parser.');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'deliverable.created', ticketId: TICKET_ID, deliverableId: d.id, agentName: 'system' });
  });

  it('feeds the reconstructed transcript (not tool noise) to the model', async () => {
    sdkResult('## CLI session\nwork');
    const { store } = makeStore();
    const { useCase } = makeUseCase(store);

    await useCase.execute({ sessionId: 'sessP', ticketId: TICKET_ID, transcriptPath: join(dir, 'ok.jsonl') });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const arg = mockedQuery.mock.calls[0]![0] as { prompt: string };
    expect(arg.prompt).toContain('Refactor the parser');
    expect(arg.prompt).toContain('Chose approach A over B for perf.');
  });

  it('is idempotent — skips when a summary for this sessionId already exists (AC2)', async () => {
    const existing = TicketDeliverableEntity.create({
      id: 'x', ticketId: TICKET_ID, agentName: 'system', type: CLI_SESSION_SUMMARY_TYPE,
      title: 't', content: 'c', status: 'final', mentionId: 'cli:sess1',
    });
    const { store, saved } = makeStore([existing]);
    const { useCase } = makeUseCase(store);

    await useCase.execute({ sessionId: 'sess1', ticketId: TICKET_ID, transcriptPath: join(dir, 'ok.jsonl') });

    expect(saved).toHaveLength(1); // only the pre-existing one
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('skips (no deliverable, no LLM call) when the transcript has no assistant content (AC4)', async () => {
    const { store, saved } = makeStore();
    const { useCase } = makeUseCase(store);

    await useCase.execute({ sessionId: 'sess2', ticketId: TICKET_ID, transcriptPath: join(dir, 'empty.jsonl') });

    expect(saved).toHaveLength(0);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('skips when the model returns the SKIP sentinel (AC4)', async () => {
    sdkResult('SKIP');
    const { store, saved } = makeStore();
    const { useCase, events } = makeUseCase(store);

    await useCase.execute({ sessionId: 'sess3', ticketId: TICKET_ID, transcriptPath: join(dir, 'ok.jsonl') });

    expect(saved).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('accumulates one deliverable per distinct session (AC8)', async () => {
    sdkResult('## CLI session\nwork');
    const { store, saved } = makeStore();
    const { useCase } = makeUseCase(store);

    await useCase.execute({ sessionId: 'sessA', ticketId: TICKET_ID, transcriptPath: join(dir, 'ok.jsonl') });
    await useCase.execute({ sessionId: 'sessB', ticketId: TICKET_ID, transcriptPath: join(dir, 'ok.jsonl') });

    expect(saved).toHaveLength(2);
    expect(saved.map((d) => d.mentionId).sort()).toEqual(['cli:sessA', 'cli:sessB']);
  });
});

describe('buildSessionPrompt (context-overflow guard)', () => {
  const turn = (role: 'user' | 'assistant', text: string): TranscriptTurn => ({ role, text });

  it('passes short sessions through verbatim (no truncation, no elision)', () => {
    const prompt = buildSessionPrompt([turn('user', 'Refactor the parser'), turn('assistant', 'Chose A over B.')], '2026-07-03 10:00');
    expect(prompt).toContain('Refactor the parser');
    expect(prompt).toContain('Chose A over B.');
    expect(prompt).not.toContain('truncated');
    expect(prompt).not.toContain('elided');
  });

  it('truncates a single over-long turn to head + tail, preserving both ends', () => {
    const huge = 'HEAD_MARKER' + 'x'.repeat(MAX_TURN_CHARS) + 'TAIL_MARKER';
    const prompt = buildSessionPrompt([turn('user', 'go'), turn('assistant', huge)], '2026-07-03 10:00');

    expect(prompt).toContain('HEAD_MARKER'); // start of the giant turn kept
    expect(prompt).toContain('TAIL_MARKER'); // end of the giant turn kept
    expect(prompt).toContain('characters truncated'); // and the middle dropped
    expect(prompt.length).toBeLessThan(MAX_TURN_CHARS + 2_000);
  });

  it('bounds a very long session and keeps the head + tail turns, eliding the middle', () => {
    // ~40 turns × ~15K chars ≈ 600K chars > MAX_TRANSCRIPT_CHARS (240K).
    const turns: TranscriptTurn[] = [turn('user', 'FIRST_TURN please refactor')];
    for (let i = 0; i < 40; i++) turns.push(turn(i % 2 === 0 ? 'assistant' : 'user', `mid ${i} ` + 'y'.repeat(15_000)));
    turns.push(turn('assistant', 'LAST_TURN done, shipped the fix'));

    const prompt = buildSessionPrompt(turns, '2026-07-03 10:00');

    expect(prompt).toContain('FIRST_TURN'); // opening ask preserved
    expect(prompt).toContain('LAST_TURN'); // final outcome preserved
    expect(prompt).toContain('intermediate turn(s) elided'); // middle dropped with a marker
    // Bounded well under haiku's window (budget + per-turn slack + fixed prompt overhead).
    expect(prompt.length).toBeLessThan(MAX_TRANSCRIPT_CHARS + 40_000);
  });
});
