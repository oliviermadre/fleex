import { describe, it, expect } from 'vitest';
import type { AgentExecution } from '@fleex/shared';
import { CachedAgentEventStore } from '../../src/infrastructure/adapters/cached-agent-event-store.js';
import type { AgentEventStorePort } from '../../src/application/ports/agent-event-store.port.js';

const exec = (id: string, startedAt: string, over: Partial<AgentExecution> = {}): AgentExecution => ({
  id, personaId: 'p-1', ticketId: 't-1', mentionId: 'm', eventCount: 0, status: 'completed', startedAt,
  completedAt: null, lastEventAt: null, sdkSessionId: null, model: null, effectiveMode: null, effort: null, fast: null,
  durationMs: null, costUsd: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null,
  ...over,
} as AgentExecution);

function storeWith(rows: AgentExecution[]): CachedAgentEventStore {
  const inner = new Proxy({ getAllExecutions: async () => rows } as Partial<AgentEventStorePort>, {
    get: (t, k) => (k in t ? t[k as keyof typeof t] : async () => undefined),
  }) as AgentEventStorePort;
  return new CachedAgentEventStore(inner);
}

describe('CachedAgentEventStore reads', () => {
  const rows = [
    exec('a', '2026-11-01T10:00:00.000Z'),
    exec('b', '2026-11-03T10:00:00.000Z', { ticketId: 't-2', personaId: 'p-2' }),
    exec('c', '2026-11-02T10:00:00.000Z', { ticketId: null }),
    exec('d', '2026-11-04T10:00:00.000Z'),
  ];

  it('lists every execution newest first', async () => {
    expect((await storeWith(rows).getAllExecutions()).map((e) => e.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it("lists a ticket's and a persona's executions newest first", async () => {
    const s = storeWith(rows);
    expect((await s.getExecutionsByTicket('t-1')).map((e) => e.id)).toEqual(['d', 'a']);
    expect((await s.getExecutionsByTicket('nope'))).toEqual([]);
    expect((await s.getExecutionsByPersona('p-1', 2)).map((e) => e.id)).toEqual(['d', 'c']);
  });

  it('reads an execution fresh after its events, and places a new one at once', async () => {
    const s = storeWith(rows);
    await s.getAllExecutions();
    await s.updateSessionId('a', 'sdk-1');
    expect((await s.getExecutionsByTicket('t-1')).find((e) => e.id === 'a')?.sdkSessionId).toBe('sdk-1');
    await s.startExecution({ executionId: 'e', personaId: 'p-2', ticketId: 't-2', mentionId: 'm' });
    expect((await s.getAllExecutions())[0]?.id).toBe('e');
    expect((await s.getExecutionsByTicket('t-2')).map((e) => e.id)).toEqual(['e', 'b']);
  });

  it('hands out a list the caller may change without changing the next one', async () => {
    const s = storeWith(rows);
    (await s.getAllExecutions()).length = 0;
    expect(await s.getAllExecutions()).toHaveLength(4);
  });
});
