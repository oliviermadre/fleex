import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentExecution } from '@fleex/shared';
import type { AgentEventStorePort } from '../../application/ports/agent-event-store.port.js';
import { CachedAgentEventStore } from './cached-agent-event-store.js';

/** Minimal inner store: only what the lifecycle paths touch. */
function makeInner(): AgentEventStorePort {
  return {
    getAllExecutions: async () => [],
    getExecutionsByTicket: async () => [],
    getExecutionsByPersona: async () => [],
    startExecution: async () => {},
    completeExecution: async () => {},
    setExecutionOutputs: async () => {},
    updateSessionId: async () => {},
    upsertCliExecution: async () => {},
    appendEvent: async () => {},
    markInterruptedExecutions: async () => [],
    getEventsByExecution: async () => [],
    getSessionHistory: async () => new Map(),
  } as unknown as AgentEventStorePort;
}

describe('CachedAgentEventStore lifecycle hook', () => {
  let store: CachedAgentEventStore;
  let seen: { executionId: string; ticketId: string | null; status: AgentExecution['status'] }[];

  beforeEach(async () => {
    store = new CachedAgentEventStore(makeInner());
    await store.warmUp();
    seen = [];
    store.onExecutionLifecycle = (e) => seen.push(e);
  });

  it('fires on start and on completion, with the ticket anchor', async () => {
    await store.startExecution({ executionId: 'e1', personaId: 'p', ticketId: 't1', mentionId: 'skill:s1' });
    await store.completeExecution('e1', 'completed');

    expect(seen).toEqual([
      { executionId: 'e1', ticketId: 't1', status: 'running' },
      { executionId: 'e1', ticketId: 't1', status: 'completed' },
    ]);
  });

  it('fires only once the cached status already reads terminal', async () => {
    // WHY: the cockpit reconcile re-reads this very cache. Notifying before the
    // write would make it observe `running` and freeze the badge — the exact
    // bug of emitting `execution_end` on the stream ahead of completeExecution.
    await store.startExecution({ executionId: 'e1', personaId: 'p', ticketId: 't1', mentionId: 'skill:s1' });
    const statusesAtNotify: (string | undefined)[] = [];
    store.onExecutionLifecycle = () => {
      statusesAtNotify.push(store['executions'].get('e1')?.status);
    };

    await store.completeExecution('e1', 'failed');

    expect(statusesAtNotify).toEqual(['failed']);
  });

  it('fires for every run orphaned by a restart', async () => {
    await store.startExecution({ executionId: 'e1', personaId: 'p', ticketId: 't1', mentionId: 'm' });
    await store.startExecution({ executionId: 'e2', personaId: 'p', ticketId: 't2', mentionId: 'm' });
    await store.completeExecution('e2', 'completed');
    seen = [];

    await store.markInterruptedExecutions();

    expect(seen).toEqual([{ executionId: 'e1', ticketId: 't1', status: 'interrupted' }]);
  });

  it('passes a null ticket through untouched (routine runs)', async () => {
    await store.startExecution({ executionId: 'e1', personaId: 'p', ticketId: null, mentionId: 'm' });

    expect(seen).toEqual([{ executionId: 'e1', ticketId: null, status: 'running' }]);
  });
});
