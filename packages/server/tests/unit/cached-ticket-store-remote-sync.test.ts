import { randomUUID } from 'node:crypto';

import { describe, it, expect } from 'vitest';

import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { CachedPersonaStore } from '../../src/infrastructure/adapters/cached-persona-store.js';
import { CachedTicketStore } from '../../src/infrastructure/adapters/cached-ticket-store.js';

import type { PersonaStorePort } from '../../src/application/ports/persona-store.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';

/**
 * Regression test for the cross-instance event-hub bug: a write-through cache
 * must re-sync from the shared store when a sibling instance's write arrives
 * over the hub, otherwise the broadcast layer re-broadcasts stale data and the
 * Kanban card never moves on the receiving instance.
 */
describe('CachedTicketStore — RemoteCacheSync', () => {
  it('re-reads the ticket from source on a remote ticket.moved event', async () => {
    const boardId = randomUUID();
    const ticketId = randomUUID();
    // Source store starts with the ticket in "doing".
    let current = TicketEntity.create({
      id: ticketId,
      boardId,
      displayId: 1,
      title: 'T',
      status: 'doing',
    });
    const inner: Partial<TicketStorePort> = {
      getAllTickets: async () => [current],
      getAllBoards: async () => [],
      getTicketById: async (id) => (id === ticketId ? current : null),
    };
    const cache = new CachedTicketStore(inner as TicketStorePort);
    await cache.warmUp();

    expect((await cache.getTicketById(ticketId))?.status).toBe('doing');

    // A sibling instance moves the ticket in the shared store and forwards the event.
    current = TicketEntity.create({
      id: ticketId,
      boardId,
      displayId: 1,
      title: 'T',
      status: 'reviewing',
    });
    const event = {
      type: 'ticket.moved',
      ticketId,
      fromStatus: 'doing',
      toStatus: 'reviewing',
      occurredAt: new Date(),
    } as unknown as AnyDomainEvent;
    await cache.applyRemoteEvent(event);

    // The cache must now reflect the sibling's write.
    expect((await cache.getTicketById(ticketId))?.status).toBe('reviewing');
  });

  it('ignores reference-only events that carry a ticketId without mutating the ticket', async () => {
    const ticketId = randomUUID();
    let reads = 0;
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId: randomUUID(),
      displayId: 1,
      title: 'T',
      status: 'doing',
    });
    const inner: Partial<TicketStorePort> = {
      getAllTickets: async () => [ticket],
      getAllBoards: async () => [],
      getTicketById: async () => {
        reads++;
        return ticket;
      },
    };
    const cache = new CachedTicketStore(inner as TicketStorePort);
    await cache.warmUp();

    // comment.posted references the ticket but does not change it — no re-read.
    const event = {
      type: 'comment.posted',
      commentId: randomUUID(),
      ticketId,
      occurredAt: new Date(),
    } as unknown as AnyDomainEvent;
    await cache.applyRemoteEvent(event);

    expect(reads).toBe(0);
  });
});

describe('CachedPersonaStore — RemoteCacheSync', () => {
  it('re-reads the persona from source on a remote persona.updated event', async () => {
    const personaId = randomUUID();
    let current = AgentPersonaEntity.create({ id: personaId, name: 'alpha' });
    const inner: Partial<PersonaStorePort> = {
      getAll: async () => [current],
      getById: async (id) => (id === personaId ? current : null),
    };
    const cache = new CachedPersonaStore(inner as PersonaStorePort);
    await cache.warmUp();

    expect((await cache.getById(personaId))?.name).toBe('alpha');

    current = AgentPersonaEntity.create({ id: personaId, name: 'beta' });
    const event = {
      type: 'persona.updated',
      personaId,
      occurredAt: new Date(),
    } as unknown as AnyDomainEvent;
    await cache.applyRemoteEvent(event);

    expect((await cache.getById(personaId))?.name).toBe('beta');
  });
});
