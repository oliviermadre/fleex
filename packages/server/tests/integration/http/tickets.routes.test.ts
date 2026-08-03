import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { KvStorePort } from '../../../src/application/ports/kv-store.port.js';
import { TicketGroupEntity } from '../../../src/domain/entities/ticket-group.entity.js';
import type { Container } from '../../../src/infrastructure/container.js';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedBoard, seedTicket, seedComment, seedDeliverable } from '../../helpers/fixtures.js';

/** Epics have no fixture helper — they only matter here as a source of `epics[]`. */
async function seedEpic(c: Container, params: { boardIds: string[]; name?: string }): Promise<TicketGroupEntity> {
  const group = TicketGroupEntity.create({
    id: randomUUID(),
    boardIds: params.boardIds,
    name: params.name ?? 'Q1',
  });
  await c.ticketGroupStore.saveTicketGroup(group);
  return group;
}

/** `kvStore` is null on the json driver; unread-counts needs one to do anything. */
function memoryKvStore(): KvStorePort {
  const data = new Map<string, string>();
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value); },
    delete: async (key) => { data.delete(key); },
    listByPrefix: async (prefix) =>
      [...data.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
  };
}

/**
 * `/api/tickets` — the busiest surface of the server and the one the web client,
 * the CLI and the agent API all lean on.
 *
 * Two behaviours get special attention because they are invisible from a status
 * code alone and break silently:
 *  - `:id` resolves a UUID *or* a displayId (`3`, `#3`), which is what makes
 *    `fleex ticket show 3` work;
 *  - every listed DTO carries an `epics` array, synthesised by the route rather
 *    than stored on the ticket — a refactor that drops the enrichment leaves the
 *    kanban cards without their epic chip and nothing else complains.
 */
describe('tickets routes', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  describe('GET /api/tickets', () => {
    it('answers 200 with an empty list when nothing is seeded', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/tickets' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 and filters by boardId', async () => {
      const a = await seedBoard(h.container, { name: 'A' });
      const b = await seedBoard(h.container, { name: 'B' });
      const onA = await seedTicket(h.container, { boardId: a.id, title: 'on A' });
      await seedTicket(h.container, { boardId: b.id, title: 'on B' });

      const all = await h.app.inject({ method: 'GET', url: '/api/tickets' });
      expect(all.statusCode).toBe(200);
      expect(all.json()).toHaveLength(2);

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets?boardId=${a.id}` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; title: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: onA.id, title: 'on A' });
    });

    it('answers 200 and narrows by boardId + status', async () => {
      const board = await seedBoard(h.container);
      const doing = await seedTicket(h.container, { boardId: board.id, status: 'doing', title: 'in flight' });
      await seedTicket(h.container, { boardId: board.id, status: 'backlog' });

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets?boardId=${board.id}&status=doing` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; status: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: doing.id, status: 'doing' });
    });

    it('answers 200 and filters by tag', async () => {
      const board = await seedBoard(h.container);
      const tagged = await seedTicket(h.container, { boardId: board.id, tags: ['bug', 'urgent'] });
      await seedTicket(h.container, { boardId: board.id, tags: ['chore'] });

      const res = await h.app.inject({ method: 'GET', url: '/api/tickets?tag=urgent' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; tags: string[] }>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: tagged.id, tags: ['bug', 'urgent'] });
    });

    it('answers 200 and filters by epicId', async () => {
      const board = await seedBoard(h.container);
      const member = await seedTicket(h.container, { boardId: board.id, title: 'in the epic' });
      await seedTicket(h.container, { boardId: board.id, title: 'outside' });
      const epic = await seedEpic(h.container, { boardIds: [board.id], name: 'Migration' });
      await h.container.ticketGroupStore.addMembership(member.id, epic.id);

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets?epicId=${epic.id}` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]?.id).toBe(member.id);
    });

    it('answers 200 with an epics array on every DTO — populated or empty', async () => {
      const board = await seedBoard(h.container);
      const member = await seedTicket(h.container, { boardId: board.id, title: 'in the epic' });
      const loner = await seedTicket(h.container, { boardId: board.id, title: 'outside' });
      const epic = await seedEpic(h.container, { boardIds: [board.id], name: 'Migration' });
      await h.container.ticketGroupStore.addMembership(member.id, epic.id);

      const res = await h.app.inject({ method: 'GET', url: '/api/tickets' });

      expect(res.statusCode).toBe(200);
      const byId = new Map(
        (res.json() as Array<{ id: string; epics: Array<{ id: string; name: string }> }>).map((t) => [t.id, t]),
      );
      expect(byId.get(member.id)?.epics).toEqual([
        expect.objectContaining({ id: epic.id, name: 'Migration' }),
      ]);
      // Never undefined: the client maps over it unconditionally.
      expect(byId.get(loner.id)?.epics).toEqual([]);
    });
  });

  describe('POST /api/tickets', () => {
    it('answers 201, assigns a displayId and emits ticket.created', async () => {
      const board = await seedBoard(h.container);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/tickets',
        payload: { boardId: board.id, title: 'First', description: 'body', priority: 'high' },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json() as { id: string; displayId: number; title: string; status: string };
      expect(created).toMatchObject({ title: 'First', status: 'backlog' });
      // displayId is what every human-facing surface (CLI, branch names, PR
      // titles) prints. `0` means createTicket() never ran.
      expect(created.displayId).toBe(1);

      expect(h.events.filter((e) => e.type === 'ticket.created')).toEqual([
        expect.objectContaining({ type: 'ticket.created', ticketId: created.id, boardId: board.id }),
      ]);
    });

    it('answers 404 BOARD_NOT_FOUND when the board does not exist', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/tickets',
        payload: { boardId: 'inconnu', title: 'Orphan' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'BOARD_NOT_FOUND' });
    });
  });

  describe('GET /api/tickets/:id', () => {
    it('answers 200 when addressed by UUID', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id, title: 'By uuid' });

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticket.id}` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: ticket.id, title: 'By uuid', epics: [] });
    });

    it('answers 200 when addressed by displayId, bare and #-prefixed', async () => {
      const board = await seedBoard(h.container);
      await seedTicket(h.container, { boardId: board.id, title: 'one' });
      await seedTicket(h.container, { boardId: board.id, title: 'two' });
      const third = await seedTicket(h.container, { boardId: board.id, title: 'three' });
      expect(third.displayId).toBe(3);

      const bare = await h.app.inject({ method: 'GET', url: '/api/tickets/3' });
      expect(bare.statusCode).toBe(200);
      expect(bare.json()).toMatchObject({ id: third.id, displayId: 3, title: 'three' });

      // `#3` is what a user copy-pastes; the CLI percent-encodes it so the `#`
      // is not read as a URL fragment.
      const hashed = await h.app.inject({ method: 'GET', url: '/api/tickets/%233' });
      expect(hashed.statusCode).toBe(200);
      expect(hashed.json()).toMatchObject({ id: third.id, displayId: 3, title: 'three' });
    });

    it('answers 404 TICKET_NOT_FOUND on an unknown id', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/tickets/inconnu' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'TICKET_NOT_FOUND', message: 'Ticket not found: inconnu' });
    });

    it('answers 404 on an unknown displayId', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/tickets/999' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });

  describe('PATCH /api/tickets/:id', () => {
    it('answers 200 with the updated ticket and records an activity row', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id, title: 'Before' });

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/tickets/${ticket.id}`,
        payload: { title: 'After', priority: 'urgent' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: ticket.id, title: 'After', priority: 'urgent' });

      const activity = await h.container.ticketStore.getActivitiesByTicket(ticket.id);
      expect(activity.map((a) => a.action)).toContain('updated');
      expect(h.events.filter((e) => e.type === 'ticket.updated')).toHaveLength(1);
    });

    it('answers 404 TICKET_NOT_FOUND on an unknown id', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/tickets/inconnu',
        payload: { title: 'Nope' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });

    /**
     * `?silent=true` means "leave no audit trace", NOT "do not broadcast".
     *
     * Its only production caller is the debounced description autosave
     * (TicketDetail.tsx, every 500 ms). Two things must hold at once, and the
     * test asserts both because getting either one alone is a real bug:
     *
     *  - nothing is recorded — neither the activity row nor a domain event log
     *    row, otherwise typing a paragraph writes one audit entry per keystroke;
     *  - `ticket.updated` still reaches the bus, because the WS broadcaster is a
     *    bus subscriber. Suppressing the event would silently stop a colleague's
     *    kanban from updating.
     */
    it('writes no audit trace with ?silent=true but still broadcasts ticket.updated', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id, title: 'Before' });

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/tickets/${ticket.id}?silent=true`,
        payload: { title: 'After' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: ticket.id, title: 'After' });

      // Audit channel 1: the activity row.
      const activity = await h.container.ticketStore.getActivitiesByTicket(ticket.id);
      expect(activity.map((a) => a.action)).not.toContain('updated');

      // Audit channel 2: the domain event log. This is the one that used to
      // ignore the flag entirely.
      const logged = await h.container.domainEventLogStore.list({ limit: 100 });
      expect(logged.filter((e) => e.eventType === 'ticket.updated')).toEqual([]);

      // …but the event is still broadcast, so live sync keeps working.
      expect(h.events.filter((e) => e.type === 'ticket.updated')).toHaveLength(1);
    });

    it('records both audit channels without ?silent=true', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id, title: 'Before' });

      await h.app.inject({
        method: 'PATCH',
        url: `/api/tickets/${ticket.id}`,
        payload: { title: 'After' },
      });

      const activity = await h.container.ticketStore.getActivitiesByTicket(ticket.id);
      expect(activity.map((a) => a.action)).toContain('updated');

      const logged = await h.container.domainEventLogStore.list({ limit: 100 });
      expect(logged.filter((e) => e.eventType === 'ticket.updated')).toHaveLength(1);
    });
  });

  describe('DELETE /api/tickets/:id', () => {
    it('answers 204, removes the ticket and emits ticket.deleted', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id });

      const res = await h.app.inject({ method: 'DELETE', url: `/api/tickets/${ticket.id}` });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(await h.container.ticketStore.getTicketById(ticket.id)).toBeNull();
      expect(h.events.filter((e) => e.type === 'ticket.deleted')).toEqual([
        expect.objectContaining({ type: 'ticket.deleted', ticketId: ticket.id }),
      ]);

      const after = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticket.id}` });
      expect(after.statusCode).toBe(404);
      expect(after.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });

    /**
     * The handler used to treat a missing ticket as "nothing to clean up" and
     * answer 204 + `ticket.deleted`, while GET/PATCH on the same id answered
     * 404. Same shape as the `DELETE /api/boards/:id` hole — see
     * boards.routes.test.ts.
     */
    it('answers 404 on an unknown id and emits no ticket.deleted', async () => {
      const res = await h.app.inject({ method: 'DELETE', url: '/api/tickets/inconnu' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
      expect(h.events.filter((e) => e.type === 'ticket.deleted')).toEqual([]);
    });
  });

  describe('archive / unarchive', () => {
    it('answers 200 on archive then 200 on unarchive, flipping archivedAt', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id });

      const archived = await h.app.inject({ method: 'POST', url: `/api/tickets/${ticket.id}/archive` });
      expect(archived.statusCode).toBe(200);
      expect((archived.json() as { archivedAt: string | null }).archivedAt).not.toBeNull();

      // An archived ticket drops out of the kanban listing but stays reachable
      // by id — that asymmetry is exactly what `ticket unarchive` relies on.
      const list = await h.app.inject({ method: 'GET', url: '/api/tickets' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([]);

      const unarchived = await h.app.inject({ method: 'POST', url: `/api/tickets/${ticket.id}/unarchive` });
      expect(unarchived.statusCode).toBe(200);
      expect((unarchived.json() as { archivedAt: string | null }).archivedAt).toBeNull();

      const back = await h.app.inject({ method: 'GET', url: '/api/tickets' });
      expect(back.statusCode).toBe(200);
      expect((back.json() as Array<{ id: string }>).map((t) => t.id)).toEqual([ticket.id]);
    });

    it('answers 200 on GET /api/tickets/archived with the archived ticket and a total', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id });
      const archived = await h.app.inject({ method: 'POST', url: `/api/tickets/${ticket.id}/archive` });
      expect(archived.statusCode).toBe(200);

      const res = await h.app.inject({ method: 'GET', url: '/api/tickets/archived' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { tickets: Array<{ id: string }>; total: number };
      expect(body.total).toBe(1);
      expect(body.tickets.map((t) => t.id)).toEqual([ticket.id]);
    });

    it('answers 404 when archiving an unknown ticket', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/api/tickets/inconnu/archive' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });

  describe('POST /api/tickets/:id/move', () => {
    it('answers 200 and emits ticket.moved carrying fromStatus and toStatus', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id, status: 'todo' });

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticket.id}/move`,
        payload: { status: 'doing', position: 5 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: ticket.id, status: 'doing', position: 5 });

      // fromStatus is only knowable at move time; every downstream consumer
      // (statistics, cycle time) reads it off this event and nowhere else.
      expect(h.events.filter((e) => e.type === 'ticket.moved')).toEqual([
        expect.objectContaining({
          type: 'ticket.moved',
          ticketId: ticket.id,
          fromStatus: 'todo',
          toStatus: 'doing',
        }),
      ]);
    });

    it('answers 404 when moving an unknown ticket', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/tickets/inconnu/move',
        payload: { status: 'doing' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });

  describe('GET /api/tickets/unread-counts', () => {
    /**
     * The static segment must beat the `/api/tickets/:id` parametric route even
     * though it is registered ~1200 lines later — otherwise this answers 404
     * TICKET_NOT_FOUND instead of a list.
     */
    it('answers 200 with an empty list when no kvStore is wired (json driver)', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/tickets/unread-counts' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 with one entry per requested ticket when a kvStore is wired', async () => {
      await h.close();
      h = await createTestApp({ overrides: { kvStore: memoryKvStore() } });

      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id });
      await seedComment(h.container, { ticketId: ticket.id, body: 'one' });
      await seedComment(h.container, { ticketId: ticket.id, body: 'two' });
      await seedDeliverable(h.container, { ticketId: ticket.id });

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/tickets/unread-counts?ticketIds=${ticket.id}`,
      });

      expect(res.statusCode).toBe(200);
      // No read cursor yet ⇒ everything counts as unread, and the totals are
      // reported anyway so the client can render "2 comments" next to the badge.
      expect(res.json()).toEqual([
        {
          ticketId: ticket.id,
          totalComments: 2,
          totalDeliverables: 1,
          unreadComments: 2,
          unreadDeliverables: 1,
        },
      ]);
    });
  });
});
