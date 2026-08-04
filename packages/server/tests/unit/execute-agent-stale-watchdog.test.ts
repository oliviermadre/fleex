import { describe, it, expect } from 'vitest';
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

  it('delegates to cancelExecution when the ghost is still tracked in this process', async () => {
    const { useCase, completed, appended } = makeUseCase([staleRow()]);
    const cancelled: string[] = [];
    // Only cancelExecution can abort the live SDK query, which is what actually
    // releases the shared SDK concurrency slot the ghost run is squatting.
    (useCase as unknown as { cancelExecution: (id: string) => Promise<boolean> }).cancelExecution =
      async (id) => { cancelled.push(id); return true; };

    const reaped = await useCase.reapStaleExecutions();

    expect(reaped).toBe(1);
    expect(cancelled).toEqual(['e1']);
    // No duplicate teardown: cancelExecution already wrote the status + event.
    expect(completed).toEqual([]);
    expect(appended).toEqual([]);
  });
});
