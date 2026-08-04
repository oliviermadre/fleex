import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ticketGroupRoutes } from '../../src/infrastructure/http/ticket-groups.routes.js';
import { TicketGroupEntity } from '../../src/domain/entities/ticket-group.entity.js';

// ---------------------------------------------------------------------------
// A PATCH that changes nothing must be invisible: no save, no domain event, no
// websocket broadcast, and `changed: []` on the way out. The ticket path already
// derives its events from the diff; this closes the same hole on epics, where a
// no-op used to wake every connected client and claim an update.
// ---------------------------------------------------------------------------

function harness(initial: { name: string; blocked?: boolean }) {
  const group = TicketGroupEntity.create({
    id: 'G1',
    boardIds: ['B1'],
    name: initial.name,
  });
  if (initial.blocked) group.update({ blocked: true });

  const events: unknown[] = [];
  const broadcasts: unknown[] = [];
  const saved: string[] = [];

  const container = {
    ticketGroupStore: {
      getTicketGroupById: async (id: string) => (id === 'G1' ? group : null),
      saveTicketGroup: async (g: TicketGroupEntity) => { saved.push(g.id); },
    },
    eventBus: { emit: (e: unknown) => { events.push(e); } },
    ticketBroadcast: (type: string, payload: unknown) => { broadcasts.push({ type, payload }); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { group, events, broadcasts, saved, container };
}

async function app(container: unknown): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await instance.register(ticketGroupRoutes(container as any));
  await instance.ready();
  return instance;
}

describe('PATCH /api/epics/:id — a no-op stays invisible', () => {
  let h: ReturnType<typeof harness>;
  let instance: FastifyInstance;

  beforeEach(async () => {
    h = harness({ name: 'Roadmap', blocked: true });
    h.events.length = 0;
    h.broadcasts.length = 0;
    instance = await app(h.container);
  });

  it('reports changed: [] and emits nothing when every value already matches', async () => {
    const before = h.group.updatedAt.getTime();

    const res = await instance.inject({
      method: 'PATCH',
      url: '/api/epics/G1',
      payload: { name: 'Roadmap', blocked: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.broadcasts).toEqual([]);
    expect(h.saved).toEqual([]);
    expect(h.group.updatedAt.getTime()).toBe(before);
  });

  it('still emits and broadcasts on a real change, naming the changed field', async () => {
    // The guard must not silence legitimate writes — this is the half of the
    // behaviour that a naive "never emit" fix would break.
    const res = await instance.inject({
      method: 'PATCH',
      url: '/api/epics/G1',
      payload: { blocked: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toEqual(['blocked']);
    expect(h.saved).toEqual(['G1']);
    expect(h.events).toHaveLength(1);
    expect(h.broadcasts).toHaveLength(1);
  });

  it('emits once when only some of the submitted fields differ', async () => {
    const res = await instance.inject({
      method: 'PATCH',
      url: '/api/epics/G1',
      payload: { name: 'Roadmap', blocked: false },
    });

    expect(res.json().changed).toEqual(['blocked']);
    expect(h.events).toHaveLength(1);
  });
});
