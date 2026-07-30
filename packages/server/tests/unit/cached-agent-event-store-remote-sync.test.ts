import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import type { AgentExecution } from '@fleex/shared';
import { CachedAgentEventStore } from '../../src/infrastructure/adapters/cached-agent-event-store.js';
import type { AgentEventStorePort } from '../../src/application/ports/agent-event-store.port.js';

const INSTANCE = { id: 'host-a:3000', label: 'host-a' };
const SIBLING = { id: 'host-b:3000', label: 'host-b' };

function execution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    id: randomUUID(),
    personaId: 'p-1',
    ticketId: 't-1',
    mentionId: 'm-1',
    eventCount: 0,
    status: 'running',
    startedAt: '2025-01-01T12:00:00.000Z',
    completedAt: null,
    lastEventAt: null,
    instanceId: INSTANCE.id,
    instanceLabel: INSTANCE.label,
    ...overrides,
  };
}

/**
 * The write-through execution cache is warmed once at boot. With shared storage a
 * sibling instance's runs land in the same table without passing through it — so
 * until it could re-sync, `GET /api/executions` never showed another machine's
 * runs, not even after a page reload.
 */
describe('CachedAgentEventStore — cross-instance coherence', () => {
  it('adds a sibling execution the cache has never seen', async () => {
    const rows = new Map<string, AgentExecution>();
    const inner: Partial<AgentEventStorePort> = {
      getAllExecutions: async () => [...rows.values()],
      getExecutionById: async (id) => rows.get(id) ?? null,
    };
    const cache = new CachedAgentEventStore(inner as AgentEventStorePort, INSTANCE);
    await cache.warmUp();
    expect(await cache.getAllExecutions()).toEqual([]);

    const remote = execution({ instanceId: SIBLING.id, instanceLabel: SIBLING.label });
    rows.set(remote.id, remote);
    await cache.refreshExecution(remote.id);

    const all = await cache.getAllExecutions();
    expect(all).toHaveLength(1);
    expect(all[0]!.instanceLabel).toBe('host-b');
    expect(all[0]!.status).toBe('running');
  });

  it('picks up a status change made by the owning instance', async () => {
    const id = randomUUID();
    let row = execution({ id, instanceId: SIBLING.id });
    const inner: Partial<AgentEventStorePort> = {
      getAllExecutions: async () => [row],
      getExecutionById: async () => row,
    };
    const cache = new CachedAgentEventStore(inner as AgentEventStorePort, INSTANCE);
    await cache.warmUp();
    expect((await cache.getExecutionsByTicket('t-1'))[0]!.status).toBe('running');

    row = { ...row, status: 'completed', completedAt: '2025-01-01T12:05:00.000Z', costUsd: 0.42 };
    await cache.refreshExecution(id);

    const [updated] = await cache.getExecutionsByTicket('t-1');
    expect(updated!.status).toBe('completed');
    expect(updated!.costUsd).toBe(0.42);
  });

  it('evicts an execution that no longer exists in the source store', async () => {
    const id = randomUUID();
    const row = execution({ id });
    let deleted = false;
    const inner: Partial<AgentEventStorePort> = {
      getAllExecutions: async () => (deleted ? [] : [row]),
      getExecutionById: async () => (deleted ? null : row),
    };
    const cache = new CachedAgentEventStore(inner as AgentEventStorePort, INSTANCE);
    await cache.warmUp();
    expect(await cache.getAllExecutions()).toHaveLength(1);

    deleted = true;
    await cache.refreshExecution(id);
    expect(await cache.getAllExecutions()).toEqual([]);
  });

  it('stamps ownership on every started execution without the caller asking', async () => {
    const started: Parameters<AgentEventStorePort['startExecution']>[0][] = [];
    const inner: Partial<AgentEventStorePort> = {
      getAllExecutions: async () => [],
      startExecution: async (p) => { started.push(p); },
    };
    const cache = new CachedAgentEventStore(inner as AgentEventStorePort, INSTANCE);
    await cache.warmUp();

    // Mirrors the five call sites, none of which pass an instance.
    await cache.startExecution({ executionId: 'e-1', personaId: 'p', ticketId: 't', mentionId: 'm' });

    expect(started[0]).toMatchObject({ instanceId: INSTANCE.id, instanceLabel: INSTANCE.label });
    const [cached] = await cache.getAllExecutions();
    expect(cached!.instanceId).toBe(INSTANCE.id);
  });

  it('leaves a sibling\'s running row alone when reclaiming our own orphans', async () => {
    const mine = execution({ id: 'mine', instanceId: INSTANCE.id });
    const theirs = execution({ id: 'theirs', instanceId: SIBLING.id });
    const inner: Partial<AgentEventStorePort> = {
      getAllExecutions: async () => [mine, theirs],
      // The real adapters carry the predicate in SQL; assert the cache honours it too.
      markInterruptedExecutions: async (instanceId) => (instanceId === INSTANCE.id ? ['m-1'] : []),
    };
    const cache = new CachedAgentEventStore(inner as AgentEventStorePort, INSTANCE);
    await cache.warmUp();

    const affected = await cache.markInterruptedExecutions(INSTANCE.id);
    expect(affected).toEqual(['m-1']);

    const byId = new Map((await cache.getAllExecutions()).map((e) => [e.id, e]));
    expect(byId.get('mine')!.status).toBe('interrupted');
    // This is the bug the instance predicate exists to prevent: restarting one
    // machine must not report another machine's live run as interrupted.
    expect(byId.get('theirs')!.status).toBe('running');
  });
});
