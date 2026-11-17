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
