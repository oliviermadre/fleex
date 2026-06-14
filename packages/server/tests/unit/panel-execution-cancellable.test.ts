import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';

/**
 * The rule (NaS): EVERY running agent execution, whoever spawned it, must be
 * abortable from the Terminate endpoint. Panel sessions (members + orchestrator)
 * run in RunPanelUseCase, outside ExecuteAgentUseCase, so they were previously
 * fire-and-forget. These tests pin the registry contract RunPanelUseCase relies
 * on: a session registered via `registerExecution` is found & aborted by
 * `cancelExecution`, cancelling one leaves siblings running (the panel keeps
 * going), and `finalizeExecution` evicts settled entries.
 */
function makeUseCase() {
  const completed: Array<{ id: string; status: string }> = [];
  const emitted: Array<{ executionId: string; eventType: string; data: unknown }> = [];

  const agentEventStore = {
    appendEvent: async (e: { executionId: string; eventType: string; data: unknown }) => {
      emitted.push({ executionId: e.executionId, eventType: e.eventType, data: e.data });
    },
    completeExecution: async (id: string, status: string) => { completed.push({ id, status }); },
  } as never;

  const mentionStore = { getById: async () => null, save: async () => {} } as never;
  const personaStore = { getById: async () => ({ id: 'p1', name: 'A' }) } as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const sdkLimiter = { run: (fn: () => Promise<unknown>) => fn() } as never;
  const stub = {} as never;

  const useCase = new ExecuteAgentUseCase(
    personaStore, mentionStore, stub, stub, stub, stub, agentEventStore, stub, stub, stub, logger, stub, sdkLimiter, stub,
  );

  return { useCase, completed, emitted };
}

describe('ExecutionRegistry — panel sessions are individually abortable', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('WHY: a registered panel member can be terminated from the UI (no more 404)', async () => {
    const { useCase, completed, emitted } = makeUseCase();
    const abortController = new AbortController();
    useCase.registerExecution({ executionId: 'exec-member-1', personaId: 'p1', ticketId: 'T1', abortController });

    const ok = await useCase.cancelExecution('exec-member-1');

    expect(ok).toBe(true);
    expect(abortController.signal.aborted).toBe(true); // SDK loop will stop
    // Marked interrupted (deliberate stop), and an interrupted execution_end emitted.
    expect(completed).toContainEqual({ id: 'exec-member-1', status: 'interrupted' });
    const endEvent = emitted.find((e) => e.eventType === 'execution_end');
    expect(endEvent).toBeDefined();
    expect((endEvent!.data as { reason?: string }).reason).toBe('cancelled');
  });

  it('WHY: terminating one member does NOT stop the others — the panel keeps running', async () => {
    const { useCase } = makeUseCase();
    const a = new AbortController();
    const b = new AbortController();
    useCase.registerExecution({ executionId: 'member-a', personaId: 'pa', ticketId: 'T', abortController: a });
    useCase.registerExecution({ executionId: 'member-b', personaId: 'pb', ticketId: 'T', abortController: b });

    await useCase.cancelExecution('member-a');

    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false); // sibling untouched
    // The surviving sibling is still abortable on its own.
    expect(await useCase.cancelExecution('member-b')).toBe(true);
    expect(b.signal.aborted).toBe(true);
  });

  it('WHY: cancel is best-effort & idempotent — unknown / already-finished id returns false, no throw', async () => {
    const { useCase } = makeUseCase();
    expect(await useCase.cancelExecution('never-registered')).toBe(false);

    const ac = new AbortController();
    useCase.registerExecution({ executionId: 'exec-x', personaId: 'p1', ticketId: 'T', abortController: ac });
    expect(await useCase.cancelExecution('exec-x')).toBe(true);
    // Second cancel of the same (now non-running) execution is a no-op, not a 500.
    expect(await useCase.cancelExecution('exec-x')).toBe(false);
  });

  it('WHY: finalizeExecution evicts a settled entry (no unbounded registry growth)', async () => {
    const { useCase } = makeUseCase();
    const ac = new AbortController();
    useCase.registerExecution({ executionId: 'exec-fin', personaId: 'p1', ticketId: 'T', abortController: ac });

    useCase.finalizeExecution('exec-fin');
    // Still present within the 30s grace window (preserves the Terminate lookup).
    vi.advanceTimersByTime(29_000);
    // A completed entry is no longer 'running', so cancel already returns false…
    expect(await useCase.cancelExecution('exec-fin')).toBe(false);
    // …and after the grace window it's gone from the map entirely.
    vi.advanceTimersByTime(2_000);
    const map = (useCase as unknown as { activeExecutions: Map<string, unknown> }).activeExecutions;
    expect(map.has('exec-fin')).toBe(false);
  });

  it('WHY: finalize never resurrects a cancelled execution to running', async () => {
    const { useCase } = makeUseCase();
    const ac = new AbortController();
    useCase.registerExecution({ executionId: 'exec-c', personaId: 'p1', ticketId: 'T', abortController: ac });

    await useCase.cancelExecution('exec-c'); // sets status 'failed'
    useCase.finalizeExecution('exec-c');     // must not flip it back to running

    expect(await useCase.cancelExecution('exec-c')).toBe(false);
  });
});
