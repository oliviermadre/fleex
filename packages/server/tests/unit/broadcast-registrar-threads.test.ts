import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/application/event-bus.js';
import { BroadcastRegistrar } from '../../src/application/broadcast-registrar.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

describe('BroadcastRegistrar — thread events', () => {
  it('pushes the thread DTO on the tickets channel for each thread.* event', async () => {
    const thread = AgentThreadEntity.create({
      id: 'th1', ticketId: 't1', personaId: 'p1', personaName: 'builder',
      assistantPersonaId: 'pa', brief: 'b', forwardedContext: [],
    });
    const threadStore = { getById: async (id: string) => (id === 'th1' ? thread : null) };
    const registrar = new BroadcastRegistrar({
      personaStore: {}, skillStore: {}, ticketStore: {}, mentionStore: {}, commentStore: {},
      deliverableStore: {}, threadStore,
    } as never);
    const pushed: Array<{ type: string; data: unknown }> = [];
    registrar.setTicketBroadcast((type, data) => pushed.push({ type, data }));
    const bus = new EventBus();
    registrar.register(bus);

    bus.emit({ type: 'thread.created', threadId: 'th1', ticketId: 't1', occurredAt: new Date() });
    bus.emit({ type: 'thread.updated', threadId: 'th1', ticketId: 't1', occurredAt: new Date() });
    bus.emit({ type: 'thread.concluded', threadId: 'th1', ticketId: 't1', occurredAt: new Date() });
    await new Promise((r) => setTimeout(r, 0));

    expect(pushed.map((p) => p.type)).toEqual(['thread:created', 'thread:updated', 'thread:concluded']);
    expect((pushed[0]!.data as { id: string }).id).toBe('th1');
  });
});
