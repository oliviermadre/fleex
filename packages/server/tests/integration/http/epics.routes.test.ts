import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedBoard, seedTicket } from '../../helpers/fixtures.js';

/**
 * `/api/epics` — served by `ticket-groups.routes.ts` ("ticket group" is the
 * domain name, "epic" the URL and the UI name; the two never got reconciled).
 *
 * Memberships are the interesting half: they are stored in their own table, so
 * "the epic lists the ticket" and "the ticket lists the epic" are two separate
 * code paths that can drift apart.
 */
describe('epics routes', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  describe('GET /api/epics', () => {
    it('answers 200 with an empty list on a virgin container', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/epics' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 and scopes to ?boardId when asked', async () => {
      const a = await seedBoard(h.container, { name: 'A' });
      const b = await seedBoard(h.container, { name: 'B' });

      const onA = await h.app.inject({ method: 'POST', url: '/api/epics', payload: { name: 'On A', boardId: a.id } });
      expect(onA.statusCode).toBe(201);
      const onB = await h.app.inject({ method: 'POST', url: '/api/epics', payload: { name: 'On B', boardId: b.id } });
      expect(onB.statusCode).toBe(201);

      const all = await h.app.inject({ method: 'GET', url: '/api/epics' });
      expect(all.statusCode).toBe(200);
      expect(all.json()).toHaveLength(2);

      const scoped = await h.app.inject({ method: 'GET', url: `/api/epics?boardId=${a.id}` });
      expect(scoped.statusCode).toBe(200);
      const body = scoped.json() as Array<{ name: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ name: 'On A' });
    });
  });

  describe('POST /api/epics', () => {
    it('answers 201 with the created epic, readable back through GET', async () => {
      const board = await seedBoard(h.container);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/epics',
        payload: { name: 'Q1 migration', boardId: board.id, emoji: '🧱', timeframe: 'next' },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json() as { id: string; name: string; emoji: string; timeframe: string; boardIds: string[]; groupStatus: string };
      expect(created).toMatchObject({
        name: 'Q1 migration',
        emoji: '🧱',
        timeframe: 'next',
        groupStatus: 'active',
        boardIds: [board.id],
      });

      const one = await h.app.inject({ method: 'GET', url: `/api/epics/${created.id}` });
      expect(one.statusCode).toBe(200);
      expect(one.json()).toMatchObject({ id: created.id, name: 'Q1 migration' });
    });

    it('answers 201 with the defaults when only a name is given', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/api/epics', payload: { name: 'Loose' } });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        name: 'Loose',
        emoji: '📌',
        color: 'fleex-purple',
        timeframe: 'now',
        boardIds: [],
      });
    });
  });

  describe('DELETE /api/epics/:id', () => {
    it('answers 204 and drops the epic from the listing', async () => {
      const board = await seedBoard(h.container);
      const created = await h.app.inject({ method: 'POST', url: '/api/epics', payload: { name: 'Doomed', boardId: board.id } });
      expect(created.statusCode).toBe(201);
      const { id } = created.json() as { id: string };

      const res = await h.app.inject({ method: 'DELETE', url: `/api/epics/${id}` });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      const list = await h.app.inject({ method: 'GET', url: '/api/epics' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([]);
    });
  });

  describe('memberships', () => {
    it('answers 201 on add, 204 on remove, and GET /tickets follows both', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id, title: 'Member' });
      const created = await h.app.inject({ method: 'POST', url: '/api/epics', payload: { name: 'Sprint', boardId: board.id } });
      expect(created.statusCode).toBe(201);
      const { id: epicId } = created.json() as { id: string };

      const before = await h.app.inject({ method: 'GET', url: `/api/epics/${epicId}/tickets` });
      expect(before.statusCode).toBe(200);
      expect(before.json()).toEqual([]);

      const add = await h.app.inject({ method: 'POST', url: `/api/epics/${epicId}/tickets/${ticket.id}` });
      expect(add.statusCode).toBe(201);
      expect(add.json()).toEqual({ ticketId: ticket.id, groupId: epicId });

      const during = await h.app.inject({ method: 'GET', url: `/api/epics/${epicId}/tickets` });
      expect(during.statusCode).toBe(200);
      const listed = during.json() as Array<{ id: string; title: string }>;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: ticket.id, title: 'Member' });

      // The mirror path: the ticket must know about the epic too.
      const reverse = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticket.id}/epics` });
      expect(reverse.statusCode).toBe(200);
      expect((reverse.json() as Array<{ id: string }>).map((g) => g.id)).toEqual([epicId]);

      const remove = await h.app.inject({ method: 'DELETE', url: `/api/epics/${epicId}/tickets/${ticket.id}` });
      expect(remove.statusCode).toBe(204);
      expect(remove.body).toBe('');

      const after = await h.app.inject({ method: 'GET', url: `/api/epics/${epicId}/tickets` });
      expect(after.statusCode).toBe(200);
      expect(after.json()).toEqual([]);
    });

    it('answers 201 and auto-links the ticket board to a board-less epic', async () => {
      const board = await seedBoard(h.container);
      const ticket = await seedTicket(h.container, { boardId: board.id });
      const created = await h.app.inject({ method: 'POST', url: '/api/epics', payload: { name: 'Loose' } });
      expect(created.statusCode).toBe(201);
      const { id: epicId } = created.json() as { id: string };

      const add = await h.app.inject({ method: 'POST', url: `/api/epics/${epicId}/tickets/${ticket.id}` });
      expect(add.statusCode).toBe(201);
      expect(add.json()).toEqual({ ticketId: ticket.id, groupId: epicId });

      // Without this auto-association the epic would hold a ticket from a board
      // it is not attached to, and `GET /api/epics?boardId=…` would hide it.
      const boards = await h.app.inject({ method: 'GET', url: `/api/epics/${epicId}/boards` });
      expect(boards.statusCode).toBe(200);
      expect(boards.json()).toEqual([board.id]);
    });

    /**
     * ⚠️  KNOWN BUG, LOCKED ON PURPOSE.
     *
     * Neither membership route looks the epic (or the ticket) up before writing.
     * `POST /api/epics/:unknown/tickets/:unknown` therefore answers 201 and
     * persists a membership row pointing at nothing, and the matching DELETE
     * answers 204 on anything at all. The dangling row is invisible until some
     * later join silently drops it.
     *
     * The fix (404 when the epic or the ticket does not exist) is its own
     * ticket. Locked here so the fix reads as a deliberate red→green diff.
     */
    it('answers 201 when both the epic and the ticket are unknown (known bug — see comment)', async () => {
      const add = await h.app.inject({ method: 'POST', url: '/api/epics/inconnu/tickets/fantome' });
      expect(add.statusCode).toBe(201);
      expect(add.json()).toEqual({ ticketId: 'fantome', groupId: 'inconnu' });

      const memberships = await h.container.ticketGroupStore.getMembershipsByGroup('inconnu');
      expect(memberships).toEqual([{ ticketId: 'fantome', groupId: 'inconnu' }]);

      const remove = await h.app.inject({ method: 'DELETE', url: '/api/epics/inconnu/tickets/fantome' });
      expect(remove.statusCode).toBe(204);
      expect(remove.body).toBe('');
    });
  });

  /**
   * ⚠️  KNOWN BUG, LOCKED ON PURPOSE.
   *
   * `TicketGroupNotFoundError` is a bare `Error` carrying a `statusCode = 404`
   * field, declared locally in ticket-groups.routes.ts. It is NOT a
   * `DomainError`, and `registerErrorHandler` only reads `error.code` on
   * `DomainError` instances — the `statusCode` field is never looked at. Every
   * "unknown epic" therefore surfaces as 500 INTERNAL_ERROR.
   *
   * The fix (make it a real `DomainError` with a code mapped to 404) is its own
   * ticket, shared with the 12 unmapped codes locked in error-handler.test.ts.
   */
  describe('unknown epic id (known bug — see comment)', () => {
    it.each([
      ['GET', '/api/epics/inconnu'],
      ['GET', '/api/epics/inconnu/tickets'],
      ['GET', '/api/epics/inconnu/boards'],
      ['DELETE', '/api/epics/inconnu'],
    ])('answers 500 on %s %s instead of 404', async (method, url) => {
      const res = await h.app.inject({ method: method as 'GET' | 'DELETE', url });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: 'INTERNAL_ERROR',
        message: 'Ticket group not found: inconnu',
      });
    });
  });
});
