import { randomUUID } from 'node:crypto';

import { describe, it, expect } from 'vitest';

import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { CachedTicketStore } from '../../src/infrastructure/adapters/cached-ticket-store.js';

import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';

/**
 * The write-through cache warms itself from getAllTickets(), which excludes
 * archived tickets. So after a warm-up (e.g. a server restart) an archived
 * ticket is absent from the cache. getTicketById / getTicketByDisplayId must
 * therefore fall back to the source of truth, otherwise `ticket unarchive`
 * (and any action on an archived ticket) 404s even with a valid identifier.
 */
describe('CachedTicketStore — archived tickets are still resolvable', () => {
  function makeArchived(id: string, displayId: number): TicketEntity {
    const t = TicketEntity.create({ id, boardId: randomUUID(), displayId, title: 'Archived' });
    t.archive();
    return t;
  }

  function makeActive(id: string, displayId: number): TicketEntity {
    return TicketEntity.create({ id, boardId: randomUUID(), displayId, title: 'Active' });
  }

  /** Inner store that models the real filtering: getAll excludes archived, point lookups span it. */
  function makeInner(all: TicketEntity[], archived: TicketEntity[]) {
    const everything = [...all, ...archived];
    let displayIdReads = 0;
    const inner: Partial<TicketStorePort> = {
      getAllTickets: async () => all,
      getAllBoards: async () => [],
      getTicketById: async (id) => everything.find((t) => t.id === id) ?? null,
      getTicketByDisplayId: async (did) => {
        displayIdReads++;
        return everything.find((t) => t.displayId === did) ?? null;
      },
    };
    return { inner: inner as TicketStorePort, stats: () => displayIdReads };
  }

  it('faults an archived ticket in by UUID on a cache miss', async () => {
    const archived = makeArchived('tk-arch', 42);
    const { inner } = makeInner([makeActive('tk-live', 1)], [archived]);
    const cache = new CachedTicketStore(inner);
    await cache.warmUp();

    // Not warmed into the cache (archived), yet still resolvable.
    const found = await cache.getTicketById('tk-arch');
    expect(found?.id).toBe('tk-arch');
    expect(found?.archivedAt).not.toBeNull();
  });

  it('faults an archived ticket in by display id on a cache miss', async () => {
    const archived = makeArchived('tk-arch', 42);
    const { inner } = makeInner([makeActive('tk-live', 1)], [archived]);
    const cache = new CachedTicketStore(inner);
    await cache.warmUp();

    const found = await cache.getTicketByDisplayId(42);
    expect(found?.id).toBe('tk-arch');
  });

  it('resolves an active ticket by display id from the cache without hitting the store', async () => {
    const { inner, stats } = makeInner([makeActive('tk-live', 7)], []);
    const cache = new CachedTicketStore(inner);
    await cache.warmUp();

    const found = await cache.getTicketByDisplayId(7);
    expect(found?.id).toBe('tk-live');
    expect(stats(), 'active lookups should be served from cache').toBe(0);
  });

  it('keeps a faulted-in archived ticket out of the active Kanban list', async () => {
    const archived = makeArchived('tk-arch', 42);
    const { inner } = makeInner([makeActive('tk-live', 1)], [archived]);
    const cache = new CachedTicketStore(inner);
    await cache.warmUp();

    await cache.getTicketById('tk-arch'); // memoises the archived ticket

    const active = await cache.getAllTickets();
    expect(active.map((t) => t.id)).toEqual(['tk-live']);
  });
});
