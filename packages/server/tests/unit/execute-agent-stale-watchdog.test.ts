import { describe, it, expect, vi } from 'vitest';
import { ExecuteAgentUseCase, STALE_EXECUTION_GRACE_MS } from '../../src/application/use-cases/execute-agent.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import type { StaleExecution } from '../../src/application/ports/agent-event-store.port.js';

const TIMEOUT_MS = 60_000;

/**
 * Safety net for ghost runs. Startup recovery only fires at boot, so a run that
 * hangs mid-flight would otherwise keep its execution row in `running` — and
 * with it "X is working." and the Terminate button — until the server restarts.
 * These tests pin the *policy*: only genuinely silent runs get reaped, and a
 * reaped run must leave the system in a state a human can act on again (mention
 * back to pending, execution_end broadcast).
 */
function makeUseCase(stale: StaleExecution[]) {
  const mention = TicketMentionEntity.create({
    id: 'm1', ticketId: 'T1', commentId: 'c1', targetAgent: 'builder', sourceAgent: 'user', targetType: 'agent',
  });
  mention.acknowledge();

  const completed: { executionId: string; status: string }[] = [];
  const appended: { executionId: string; eventType: string; data: Record<string, unknown> }[] = [];
  let cutoffSeen: string | undefined;

  const agentEventStore = {
    findStaleRunningExecutions: async (cutoff: string) => { cutoffSeen = cutoff; return stale; },
    completeExecution: async (executionId: string, status: string) => { completed.push({ executionId, status }); },
    appendEvent: async (e: { executionId: string; eventType: string; data: Record<string, unknown> }) => { appended.push(e); },
  } as never;

  const mentionStore = {
    getById: async (id: string) => (id === mention.id ? mention : null),
    save: async () => {},
  } as never;

  const config = { get: () => ({ agentExecutionTimeout: TIMEOUT_MS }) } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const stub = {} as never;

  const useCase = new ExecuteAgentUseCase(
    stub, mentionStore, stub, stub, stub, stub, agentEventStore, stub, stub, config, logger, stub, stub, stub,
  );

  const broadcast: string[] = [];
  useCase.onEvent = (e) => broadcast.push(e.eventType);

  return { useCase, mention, completed, appended, broadcast, cutoff: () => cutoffSeen };
}

function staleRow(): StaleExecution {
  return {
    executionId: 'e1', personaId: 'p1', ticketId: 'T1', mentionId: 'm1',
    lastActivityAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  };
}

describe('ExecuteAgentUseCase — stale execution watchdog', () => {
  it('closes an orphaned running execution and frees its mention for a retry', async () => {
    const { useCase, mention, completed, appended, broadcast } = makeUseCase([staleRow()]);

    const reaped = await useCase.reapStaleExecutions();

    expect(reaped).toBe(1);
    // The row must reach a terminal state — that is what removes "is working."
    expect(completed).toEqual([{ executionId: 'e1', status: 'interrupted' }]);
    // …and an execution_end must be broadcast so the open UI recovers without a
    // reload, matching what a reload would show.
    expect(appended[0]?.eventType).toBe('execution_end');
    expect(appended[0]?.data).toMatchObject({ status: 'interrupted', reason: 'stale' });
    expect(broadcast).toEqual(['execution_end']);
    // The work wasn't done, so the mention goes back in the queue rather than
    // being silently swallowed.
    expect(mention.status).toBe('pending');
  });

  it('only considers runs silent for longer than the execution timeout plus its grace', async () => {
    const { useCase, cutoff } = makeUseCase([]);

    const before = Date.now();
    await useCase.reapStaleExecutions();

    // A run that is merely slow is aborted by its own timeout first; the
    // watchdog must never race it, hence the extra grace margin.
    const expected = before - TIMEOUT_MS - STALE_EXECUTION_GRACE_MS;
    expect(new Date(cutoff()!).getTime()).toBeGreaterThanOrEqual(expected - 1000);
    expect(new Date(cutoff()!).getTime()).toBeLessThanOrEqual(expected + 1000);
  });

  it('never reaps an execution this process still owns, however long it has been silent', async () => {
    const { useCase, mention, completed, appended, broadcast } = makeUseCase([staleRow()]);
    const abortController = new AbortController();
    useCase.registerExecution({ executionId: 'e1', personaId: 'p1', ticketId: 'T1', abortController });

    // `last_event_at` only says "an SDK message arrived recently", which a live
    // agent can legitimately starve: one long tool call, or a lead agent waiting
    // on a fleet of subagents, emits nothing for as long as it runs. Killing it
    // would abort the subprocess mid-work. Ownership is the honest liveness
    // signal — and an owned run that is genuinely stuck is already bounded by
    // its own execution timeout.
    for (let tick = 0; tick < 5; tick++) {
      expect(await useCase.reapStaleExecutions()).toBe(0);
    }

    expect(abortController.signal.aborted).toBe(false);
    expect(completed).toEqual([]);
    expect(appended).toEqual([]);
    expect(broadcast).toEqual([]);
    expect(mention.status).toBe('acknowledged');

    // Once the run settles and leaves the registry, the row is fair game again:
    // this is the orphan case the watchdog actually exists for.
    useCase.finalizeExecution('e1');
    expect(await useCase.reapStaleExecutions()).toBe(1);
    expect(completed).toEqual([{ executionId: 'e1', status: 'interrupted' }]);
  });

  it('skips a scan after a clock jump rather than reaping everything at once', async () => {
    const { useCase, completed } = makeUseCase([staleRow()]);
    vi.useFakeTimers();
    try {
      // Baseline tick. Nothing is owned here, so this one legitimately reaps.
      expect(await useCase.reapStaleExecutions()).toBe(1);
      completed.length = 0;

      // Laptop sleep: timers were frozen while wall-clock advanced, so every
      // in-flight run now *looks* ancient although its subprocess merely paused.
      vi.setSystemTime(new Date(Date.now() + 60 * 60_000));
      expect(await useCase.reapStaleExecutions()).toBe(0);
      expect(completed).toEqual([]);

      // Baseline is re-established, so the next normal tick works as usual.
      expect(await useCase.reapStaleExecutions()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
