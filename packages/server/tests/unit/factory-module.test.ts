/**
 * What the Factory module hears from the rest of Fleex: a comment that launches
 * something, a reply to a question, a skill or a panel launched by its button,
 * and a workflow asked for on a ticket of the floor.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../../src/application/event-bus.js';
import { FactoryModule, createFactoryModule } from '../../src/factory/factory.module.js';
import type { FactoryStorePort } from '../../src/factory/factory-store.port.js';
import type { FactoryFloorRow, FactoryTicketRow } from '../../src/factory/types.js';
import type { MentionTargetType } from '../../src/domain/events.js';

function memoryStore(): FactoryStorePort {
  const floors = new Map<string, FactoryFloorRow>(), tickets = new Map<string, FactoryTicketRow>();
  return {
    getFloor: async (id) => floors.get(id) ?? null,
    saveFloor: async (f) => { floors.set(f.id, structuredClone(f)); },
    listTickets: async () => [...tickets.values()],
    saveTicket: async (t) => { tickets.set(t.ticketId, structuredClone(t)); },
    removeTicket: async (id) => { tickets.delete(id); },
    listManagedTicketIds: async () => [...tickets.keys()],
    listItems: async () => [], getItemByKey: async () => null, saveItem: async () => {}, countDropped: async () => ({}), listIntakePulls: async () => [], listExitItems: async () => [], saveIntakePull: async () => {}, saveItemRun: async () => {}, listItemRuns: async () => [],
    saveRun: async () => {},
    listRunsByTicket: async () => [], listRecentRuns: async () => [], listRunsSince: async () => [], countRunsSince: async () => 0,
    interruptRunningRuns: async () => [],
  } as FactoryStorePort;
}

let bus: EventBus;
let enabled: boolean;
let factory: FactoryModule;

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const comment = (ticketId: string, authorType: 'user' | 'agent', mentions: MentionTargetType[] = []) => bus.emit({
  type: 'comment.posted', commentId: 'c1', ticketId, authorType, authorName: 'someone', occurredAt: new Date(),
  createdMentions: mentions.map((targetType, i) => ({ mentionId: `m${i}`, targetAgent: 'x', targetType })),
});

beforeEach(async () => {
  bus = new EventBus(); enabled = true;
  const ticket = { toDTO: () => ({ id: 'a', displayId: 1, title: 'A', status: 'todo', boardId: 'b1', archivedAt: null }) };
  factory = createFactoryModule({
    store: memoryStore(), eventBus: bus,
    config: { get: () => ({ factoryEnabled: enabled }) } as never,
    ticketStore: { getTicketById: async (id: string) => (id === 'a' ? ticket : null) } as never,
    skillStore: {} as never, personaStore: {} as never, agentEventStore: {} as never, executeAgent: {} as never, runPanel: {} as never,
    applyTicketMutation: { execute: async () => {} } as never, submitDeliverable: {} as never, postComment: {} as never,
    logger: { warn: () => {}, info: () => {} },
  })!;
  await factory.ensureReady();
  await factory.engine.transfer('a');
});

describe('FactoryModule: what it hears from the ticket thread', () => {
  it('takes a comment of a person that launches an agent, a skill or a panel as a launch by hand', async () => {
    const launched = vi.spyOn(factory.engine, 'launchedByHand'), answered = vi.spyOn(factory.engine, 'answered');
    for (const kind of ['agent', 'skill', 'panel'] as const) comment('a', 'user', [kind]);
    await settle();
    expect(launched.mock.calls).toEqual([['a'], ['a'], ['a']]);
    expect(answered).not.toHaveBeenCalled();
  });

  it('takes a plain reply of a person as a possible answer, whatever else it mentions', async () => {
    const launched = vi.spyOn(factory.engine, 'launchedByHand'), answered = vi.spyOn(factory.engine, 'answered');
    comment('a', 'user');
    comment('a', 'user', ['human']);
    await settle();
    expect(answered.mock.calls).toEqual([['a'], ['a']]);
    expect(launched).not.toHaveBeenCalled();
  });

  it('ignores what an agent writes, tickets that are not on the floor, and everything when the Factory is off', async () => {
    const launched = vi.spyOn(factory.engine, 'launchedByHand'), answered = vi.spyOn(factory.engine, 'answered');
    comment('a', 'agent', ['agent']);
    comment('elsewhere', 'user', ['agent']);
    enabled = false;
    comment('a', 'user', ['agent']);
    await factory.launchedByHand('a');
    await settle();
    expect(launched).not.toHaveBeenCalled();
    expect(answered).not.toHaveBeenCalled();
  });

  it('passes on a skill or a panel launched by its button, for a ticket of the floor only', async () => {
    const launched = vi.spyOn(factory.engine, 'launchedByHand');
    await factory.launchedByHand('a');
    await factory.launchedByHand('elsewhere');
    expect(launched.mock.calls).toEqual([['a']]);
  });

  it('refuses a workflow on a ticket of the floor, and on no other', () => {
    expect(factory.refusesWorkflow('a')).toMatch(/factory floor/);
    expect(factory.refusesWorkflow('elsewhere')).toBeNull();
    enabled = false;
    expect(factory.refusesWorkflow('a')).toBeNull();
  });
});

describe('FactoryModule: what it reads, and when', () => {
  it('re-reads a ticket of the floor when it is changed elsewhere in Fleex, and no other', async () => {
    const changed = vi.spyOn(factory.engine, 'ticketChanged');
    bus.emit({ type: 'ticket.updated', ticketId: 'a', changes: {}, occurredAt: new Date() } as never);
    bus.emit({ type: 'ticket.moved', ticketId: 'a', occurredAt: new Date() } as never);
    bus.emit({ type: 'ticket.updated', ticketId: 'elsewhere', changes: {}, occurredAt: new Date() } as never);
    await settle();
    expect(changed.mock.calls).toEqual([['a'], ['a']]);
  });

  it('loads the floor on its own once the flag is on, without waiting for the Factory page, and reads nothing while it is off', async () => {
    vi.useFakeTimers();
    try {
      enabled = false;
      const reads = vi.fn(async () => null);
      const store = { ...memoryStore(), getFloor: reads };
      const off = createFactoryModule({
        store, eventBus: new EventBus(), config: { get: () => ({ factoryEnabled: enabled }) } as never,
        ticketStore: {} as never, skillStore: {} as never, personaStore: {} as never, agentEventStore: {} as never, executeAgent: {} as never, runPanel: {} as never,
        applyTicketMutation: {} as never, submitDeliverable: {} as never, postComment: {} as never, logger: { warn: () => {}, info: () => {} },
      })!;
      off.start();
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads).not.toHaveBeenCalled();
      enabled = true;
      await vi.advanceTimersByTimeAsync(500);
      expect(reads).toHaveBeenCalledTimes(1);
      expect(off.managedTicketIds()).not.toBeNull();
      await off.stop();
    } finally { vi.useRealTimers(); }
  });

  it('tries a floor that could not be loaded again after a while, not at every tick', async () => {
    vi.useFakeTimers();
    try {
      const reads = vi.fn(async () => { throw new Error('down'); });
      const broken = createFactoryModule({
        store: { ...memoryStore(), getFloor: reads }, eventBus: new EventBus(), config: { get: () => ({ factoryEnabled: true }) } as never,
        ticketStore: {} as never, skillStore: {} as never, personaStore: {} as never, agentEventStore: {} as never, executeAgent: {} as never, runPanel: {} as never,
        applyTicketMutation: {} as never, submitDeliverable: {} as never, postComment: {} as never, logger: { warn: () => {}, info: () => {} },
      })!;
      broken.start();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(reads).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(reads).toHaveBeenCalledTimes(2);
      await broken.stop();
    } finally { vi.useRealTimers(); }
  });
});

describe('FactoryModule: what left by an exit', () => {
  it('lists the tickets an exit shipped over the period, as they are now, the latest first, and the items archived there', async () => {
    const day = 86_400_000, ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const run = (ticketId: string, shipped: string, machineId = 'out', executor = 'exit') => ({ id: `r-${ticketId}-${machineId}`, ticketId, floorId: 'default', machineId, machineName: 'Out', executor, status: 'completed', outcome: 'shipped', executionId: null, error: null, startedAt: ago(3 * day), finishedAt: shipped });
    const runs = [run('a', ago(2 * day)), run('gone', ago(day)), run('a', ago(10 * day)), run('a', ago(day), 'dev', 'agent')];
    const store = factory.store as unknown as Record<string, unknown>;
    store['listRecentRuns'] = async (_f: string, _n: number, machineId: string) => runs.filter((r) => r.machineId === machineId);
    store['listExitItems'] = async (_f: string, machineId: string, since: string) => (machineId === 'out' && since < ago(day) ? [{ id: 'i1', machineId: 'out', source: 'gmail', title: 'Invoice', author: 'Ana', url: null, tags: [], createdAt: ago(2 * day), archivedAt: ago(day / 2) }] : []);
    const log = await factory.exitLog('out', 7);
    expect(log.days).toBe(7);
    expect(log.tickets.map((t) => [t.ticketId, t.displayId, t.title, t.status])).toEqual([['gone', null, 'A ticket deleted since', null], ['a', 1, 'A', 'todo']]);
    expect(log.items).toMatchObject([{ itemId: 'i1', source: 'gmail', title: 'Invoice' }]);
    expect((await factory.exitLog('out', 1)).tickets).toEqual([]);
    expect(log.exits).toEqual([{ machineId: 'out', name: 'Out', onFloor: false }]);
    expect(log.tickets[0]!.machineId).toBe('out');
  });

  it('gathers every exit of the floor, each named, with those the runs only remember', async () => {
    const day = 86_400_000, ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const run = (ticketId: string, machineId: string, machineName: string) => ({ id: `r-${ticketId}-${machineId}`, ticketId, floorId: 'default', machineId, machineName, executor: 'exit', status: 'completed', outcome: 'shipped', executionId: null, error: null, startedAt: ago(3 * day), finishedAt: ago(day) });
    const store = factory.store as unknown as Record<string, unknown>;
    let asked: unknown = 'not asked';
    store['listRunsSince'] = async () => [run('a', 'x1', 'Delivery'), run('a', 'old', 'Old exit'), { ...run('a', 'dev', 'Dev'), executor: 'agent' }];
    store['listExitItems'] = async (_f: string, machineId: string | null) => { asked = machineId; return []; };
    await factory.engine.setLayout({ version: 2, w: 0, h: 0, machines: [{ id: 'x1', kind: 'exit', x: 0, y: 0, w: 3, h: 3, name: 'Delivery' }, { id: 'x2', kind: 'exit', x: 5, y: 0, w: 3, h: 3, name: '' }] } as never);
    const log = await factory.exitLog(null, 7);
    expect(asked).toBeNull();
    expect(log.machineId).toBeNull();
    expect(log.exits).toEqual([{ machineId: 'x1', name: 'Delivery', onFloor: true }, { machineId: 'x2', name: 'Exit', onFloor: true }, { machineId: 'old', name: 'Old exit', onFloor: false }]);
    expect(log.tickets.map((t) => t.machineId)).toEqual(['x1', 'old']);
  });
});
