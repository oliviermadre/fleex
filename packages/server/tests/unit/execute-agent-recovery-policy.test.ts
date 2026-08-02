import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import type { DomainEvent } from '../../src/domain/events.js';

// The timeout suite below needs an SDK call that hangs until it is aborted. The
// other suites never reach the SDK, so the mock is inert for them.
vi.mock('../../src/application/utils/stream-sdk-query.js', () => ({
  streamSdkQuery: async ({ abortSignal }: { abortSignal: AbortSignal }) => {
    await new Promise((resolve) => abortSignal.addEventListener('abort', resolve, { once: true }));
    return { sessionId: 'sdk-session-1', resultText: '', structuredOutput: null, metrics: {}, messageCount: 1, stderr: '' };
  },
  summarizeStderr: (s: string) => s,
}));

/**
 * These tests cover the three doors that used to silently send a mention back to
 * `pending` — boot recovery, user cancel, and timeout — plus where the attempt
 * budget is charged. See `docs/execution-recovery-policy.md`.
 *
 * Why it matters everywhere below: `handleAutoTriggerAgent` calls
 * `execute(personaId)`, which sweeps EVERY `pending` mention of that persona. A
 * mention put back to `pending` by the system is therefore re-dispatched by the
 * next unrelated mention to the same agent — an invisible retry loop on an
 * unresolved cause.
 */

function makeMention(id: string, agent = 'A', ticketId = 'T'): TicketMentionEntity {
  return TicketMentionEntity.create({
    id, ticketId, commentId: `c-${id}`, targetAgent: agent, sourceAgent: 'user', targetType: 'agent',
  });
}

function makeHarness(opts: { interrupted?: string[] } = {}) {
  const persona = { id: 'p1', name: 'A', model: 'claude-sonnet-4-5', executionMode: 'claude_code' } as never;
  const mentions = new Map<string, TicketMentionEntity>();
  const events: DomainEvent[] = [];
  const completedExecutions: Array<{ executionId: string; status: string }> = [];
  const appended: Array<{ eventType: string; data: Record<string, unknown> }> = [];

  const mentionStore = {
    getById: async (id: string) => mentions.get(id) ?? null,
    getByTicket: async (ticketId: string) => [...mentions.values()].filter((m) => m.ticketId === ticketId),
    getPendingForAgent: async (name: string) =>
      [...mentions.values()].filter((m) => m.targetAgent === name && m.status === 'pending'),
    save: async (m: TicketMentionEntity) => { mentions.set(m.id, m); },
  } as never;

  const agentEventStore = {
    markInterruptedExecutions: async () => opts.interrupted ?? [],
    getSessionHistory: async () => new Map(),
    appendEvent: async (e: { eventType: string; data: Record<string, unknown> }) => {
      appended.push({ eventType: e.eventType, data: e.data });
    },
    completeExecution: async (executionId: string, status: string) => {
      completedExecutions.push({ executionId, status });
    },
    updateSessionId: async () => {},
  } as never;

  const personaStore = { getById: async () => persona, getByName: async () => persona } as never;
  // No ticket → ensureWorkspace returns null → the pre-acknowledge throw.
  const ticketStore = { getTicketById: async () => null } as never;
  const config = { get: () => ({ agentMaxAttempts: 3 }) } as never;
  const sdkLimiter = { run: (fn: () => Promise<unknown>) => fn() } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const stub = {} as never;

  const useCase = new ExecuteAgentUseCase(
    personaStore, mentionStore, stub, stub, stub, stub, agentEventStore, ticketStore,
    stub, config, logger, stub, sdkLimiter, stub,
  );
  useCase.eventBus = { emit: (e: DomainEvent) => { events.push(e); } } as never;

  return { useCase, mentions, events, completedExecutions, appended, persona };
}

describe('startup recovery (init)', () => {
  // WHY: this is the ticket's second bug. Boot used to call `resetToPending()`,
  // so every orphaned mention was silently re-dispatched by the next
  // auto-trigger — an automatic relaunch of a run nobody diagnosed, and the
  // exact opposite of what a crash does.
  it('marks an orphaned mention failed instead of re-queueing it', async () => {
    const { useCase, mentions } = makeHarness({ interrupted: ['m1'] });
    const m = makeMention('m1');
    m.acknowledge();
    mentions.set('m1', m);

    await useCase.init();

    expect(mentions.get('m1')!.status).toBe('failed');
    expect(mentions.get('m1')!.failureReason).toBe('server_restart');
  });

  // WHY: without the event the UI keeps the mention spinning in "acknowledged"
  // until a manual reload — the crash card would never appear.
  it('announces the restart so the crash card can render', async () => {
    const { useCase, mentions, events } = makeHarness({ interrupted: ['m1'] });
    const m = makeMention('m1');
    m.acknowledge();
    mentions.set('m1', m);

    await useCase.init();

    const failed = events.find((e) => e.type === 'mention.execution_failed');
    expect(failed).toBeDefined();
    expect((failed as { reason: string }).reason).toBe('server_restart');
  });

  // WHY: a mention the human already answered (resolved) or that is parked
  // waiting on the human must not be dragged into a crash state by a restart.
  it('leaves a resolved mention untouched', async () => {
    const { useCase, mentions } = makeHarness({ interrupted: ['m1'] });
    const m = makeMention('m1');
    m.acknowledge();
    m.resolve();
    mentions.set('m1', m);

    await useCase.init();

    expect(mentions.get('m1')!.status).toBe('resolved');
    expect(mentions.get('m1')!.failureReason).toBeNull();
  });
});

describe('user cancel (Terminate)', () => {
  // WHY: the third silent-re-pending door. Cancel is a human decision to stop —
  // sending the mention back to `pending` made the very next mention to that
  // agent silently restart the run the human just killed.
  it('marks the mention failed with the cancelled cause', async () => {
    const { useCase, mentions } = makeHarness();
    const m = makeMention('m1');
    m.acknowledge();
    mentions.set('m1', m);

    const abortController = new AbortController();
    useCase.registerExecution({ executionId: 'e1', personaId: 'p1', ticketId: 'T', abortController } as never);
    // registerExecution keys by executionId; the cancel path looks the mention up
    // by that same key, so align the map entry with the mention under test.
    (useCase as unknown as { activeExecutions: Map<string, unknown> }).activeExecutions.set('m1', {
      mentionId: 'm1', executionId: 'e1', personaId: 'p1', ticketId: 'T', status: 'running', abortController,
    });
    (useCase as unknown as { activeExecutions: Map<string, unknown> }).activeExecutions.delete('e1');

    await useCase.cancelExecution('e1');

    expect(mentions.get('m1')!.status).toBe('failed');
    expect(mentions.get('m1')!.failureReason).toBe('cancelled');
  });

  // WHY: the audit trail must keep distinguishing "the human stopped it" from
  // "the system gave up" — so the *execution* stays `interrupted` even though
  // the *mention* is `failed`.
  it('keeps the execution interrupted, not failed', async () => {
    const { useCase, mentions, completedExecutions } = makeHarness();
    const m = makeMention('m1');
    m.acknowledge();
    mentions.set('m1', m);

    const abortController = new AbortController();
    (useCase as unknown as { activeExecutions: Map<string, unknown> }).activeExecutions.set('m1', {
      mentionId: 'm1', executionId: 'e1', personaId: 'p1', ticketId: 'T', status: 'running', abortController,
    });

    await useCase.cancelExecution('e1');

    expect(completedExecutions).toEqual([{ executionId: 'e1', status: 'interrupted' }]);
  });

  it('announces the cancellation so the card shows why the run stopped', async () => {
    const { useCase, mentions, events } = makeHarness();
    const m = makeMention('m1');
    m.acknowledge();
    mentions.set('m1', m);

    const abortController = new AbortController();
    (useCase as unknown as { activeExecutions: Map<string, unknown> }).activeExecutions.set('m1', {
      mentionId: 'm1', executionId: 'e1', personaId: 'p1', ticketId: 'T', status: 'running', abortController,
    });

    await useCase.cancelExecution('e1');

    const failed = events.find((e) => e.type === 'mention.execution_failed');
    expect((failed as { reason: string } | undefined)?.reason).toBe('cancelled');
  });
});

/**
 * Drive a real `executeForMention` far enough to reach the SDK call, in `talk`
 * mode so no worktree is needed, with a 5 ms timeout and an SDK stub that hangs
 * until aborted. Prompt composition is stubbed out — it is covered elsewhere and
 * is not what this policy is about.
 */
function makeTimeoutHarness() {
  const persona = {
    id: 'p1', name: 'A', model: 'claude-sonnet-4-5',
    executionMode: 'message', // → talk mode: skips workspace creation
  } as never;
  const mentions = new Map<string, TicketMentionEntity>();
  const events: DomainEvent[] = [];
  const completedExecutions: Array<{ executionId: string; status: string }> = [];
  const emitted: string[] = [];

  const mentionStore = {
    getById: async (id: string) => mentions.get(id) ?? null,
    getByTicket: async () => [...mentions.values()],
    getPendingForAgent: async () => [],
    save: async (m: TicketMentionEntity) => { mentions.set(m.id, m); },
  } as never;

  const agentEventStore = {
    startExecution: async () => {},
    appendEvent: async (e: { eventType: string }) => { emitted.push(e.eventType); },
    completeExecution: async (executionId: string, status: string) => {
      completedExecutions.push({ executionId, status });
    },
    updateSessionId: async () => {},
  } as never;

  const personaStore = { getById: async () => persona, getByName: async () => persona } as never;
  // assignee already set → no claim path; no links → repoCount 0.
  const ticketStore = {
    getTicketById: async () => ({ id: 'T', assignee: 'A', links: [], conversationMode: 'talk' }),
    saveTicket: async () => {},
  } as never;
  const getTicketContext = {
    execute: async () => ({
      ticket: { title: 'T', status: 'doing' }, comments: [], deliverables: [],
    }),
  } as never;
  const config = { get: () => ({ agentExecutionTimeout: 5, agentMaxAttempts: 3 }) } as never;
  const sdkLimiter = { run: (fn: () => Promise<unknown>) => fn() } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const stub = {} as never;

  const useCase = new ExecuteAgentUseCase(
    personaStore, mentionStore, stub, stub, stub, getTicketContext, agentEventStore, ticketStore,
    stub, config, logger, stub, sdkLimiter, stub,
  );
  useCase.eventBus = { emit: (e: DomainEvent) => { events.push(e); } } as never;

  const u = useCase as unknown as Record<string, unknown>;
  u['resolveHumanMentionName'] = () => null;
  u['composeSystemPrompt'] = () => 'system';
  u['composeUserPrompt'] = async () => [{ type: 'text', text: 'do the thing' }];
  u['outputFormatSchema'] = () => undefined;

  return { useCase, mentions, events, completedExecutions, emitted, persona };
}

describe('execution timeout', () => {
  // WHY: this is the ticket's headline bug. The timeout used to call
  // `resetToPending()`, so a 30-minute run that produced nothing was silently
  // re-dispatched by the next auto-trigger — the "re-pending silencieux" #443
  // set out to remove, still alive on the timeout path.
  it('marks the mention failed with the timeout cause instead of re-queueing it', async () => {
    const { useCase, mentions, persona } = makeTimeoutHarness();
    const m = makeMention('m1');
    mentions.set('m1', m);

    await (useCase as unknown as {
      executeForMention: (p: unknown, m: TicketMentionEntity) => Promise<void>;
    }).executeForMention(persona, m);

    const saved = mentions.get('m1')!;
    expect(saved.status).toBe('failed');
    expect(saved.failureReason).toBe('timeout');
  });

  // WHY: "a timed-out agent appears in `failed`" is an acceptance criterion of
  // the ticket, and the cockpit derives `idle` from the execution status — an
  // `interrupted` execution would read as a neutral stop, not a failure.
  it('records the execution as failed, not interrupted', async () => {
    const { useCase, mentions, completedExecutions, persona } = makeTimeoutHarness();
    const m = makeMention('m1');
    mentions.set('m1', m);

    await (useCase as unknown as {
      executeForMention: (p: unknown, m: TicketMentionEntity) => Promise<void>;
    }).executeForMention(persona, m);

    expect(completedExecutions).toHaveLength(1);
    expect(completedExecutions[0]!.status).toBe('failed');
  });

  // WHY: without the event the card never appears and the mention just stops
  // moving — the crash stays invisible, which is the whole point of the ticket.
  it('announces the timeout with its cause and the attempt budget', async () => {
    const { useCase, mentions, events, persona } = makeTimeoutHarness();
    const m = makeMention('m1');
    mentions.set('m1', m);

    await (useCase as unknown as {
      executeForMention: (p: unknown, m: TicketMentionEntity) => Promise<void>;
    }).executeForMention(persona, m);

    const failed = events.find((e) => e.type === 'mention.execution_failed') as
      | { reason: string; attemptCount: number; maxAttempts: number }
      | undefined;
    expect(failed?.reason).toBe('timeout');
    expect(failed?.attemptCount).toBe(1);
    expect(failed?.maxAttempts).toBe(3);
  });
});

/**
 * The load-bearing invariant of the policy, asserted on the source itself.
 *
 * `handleAutoTriggerAgent` sweeps EVERY `pending` mention of a persona, so any
 * system-initiated `resetToPending()` re-opens the silent-relaunch hole this
 * ticket closes. A behavioural test can only cover the doors we already know
 * about; this one fails the moment a NEW one is opened anywhere in the file.
 */
describe('invariant: only an explicit human action re-queues a mention', () => {
  it('calls resetToPending() from runMention and nowhere else', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/application/use-cases/execute-agent.ts', import.meta.url)),
      'utf8',
    );

    const callSites = [...src.matchAll(/\.resetToPending\(\)/g)].map((m) => m.index!);
    expect(callSites).toHaveLength(1);

    // `runMention` runs until the next member's doc comment at class indentation.
    const start = src.indexOf('async runMention(');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n  /**', start);
    expect(callSites[0]).toBeGreaterThan(start);
    expect(callSites[0]).toBeLessThan(end);
  });
});

describe('attempt budget charged at dispatch', () => {
  // WHY: the budget only stops a crash loop if it is charged BEFORE the worktree
  // is created. Charging at acknowledge would leave the failures that never
  // reach the SDK — workspace error, quota, auth — uncounted, i.e. infinitely
  // retryable, which is precisely the loop the ticket asks us to break.
  it('counts an attempt for a run that dies before acknowledge', async () => {
    const { useCase, mentions, persona } = makeHarness();
    const m = makeMention('m1');
    mentions.set('m1', m);

    await expect(
      (useCase as unknown as {
        executeForMention: (p: unknown, m: TicketMentionEntity) => Promise<void>;
      }).executeForMention(persona, m),
    ).rejects.toThrow();

    const saved = mentions.get('m1')!;
    expect(saved.attemptCount).toBe(1);
    expect(saved.status).toBe('failed');
    expect(saved.failureReason).toBe('startup_error');
  });
});
