import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedBoard, seedTicket } from '../../helpers/fixtures.js';

/**
 * `/api/boards` — the CRUD every other ticket-shaped route depends on.
 *
 * A fresh container has NO board (`JsonTicketStore` installs no default), which
 * makes "virgin container" a first-class case here rather than an edge one: the
 * web client's very first request on a new install hits exactly this state.
 */
describe('boards routes', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  describe('GET /api/boards', () => {
    it('answers 200 with an empty list on a virgin container', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/boards' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 with the seeded board and a count per status', async () => {
      const board = await seedBoard(h.container, { name: 'Product', emoji: '🚀' });
      await seedTicket(h.container, { boardId: board.id, status: 'todo' });
      await seedTicket(h.container, { boardId: board.id, status: 'todo' });
      await seedTicket(h.container, { boardId: board.id, status: 'done' });

      const res = await h.app.inject({ method: 'GET', url: '/api/boards' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; name: string; emoji: string; ticketCounts: Record<string, number> }>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: board.id, name: 'Product', emoji: '🚀' });
      // The kanban column headers read straight off this map, so a missing key
      // is a blank column, not a crash — worth pinning key by key.
      expect(body[0]?.ticketCounts).toEqual({
        backlog: 0,
        todo: 2,
        doing: 0,
        reviewing: 0,
        done: 1,
        cancelled: 0,
      });
    });
  });

  describe('POST /api/boards', () => {
    it('answers 201 with the created board, readable back through GET', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/boards',
        payload: { name: 'Design', emoji: '🎨' },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json() as { id: string; name: string; emoji: string };
      expect(created).toMatchObject({ name: 'Design', emoji: '🎨' });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

      const list = await h.app.inject({ method: 'GET', url: '/api/boards' });
      expect(list.statusCode).toBe(200);
      expect((list.json() as Array<{ id: string }>).map((b) => b.id)).toEqual([created.id]);

      const one = await h.app.inject({ method: 'GET', url: `/api/boards/${created.id}` });
      expect(one.statusCode).toBe(200);
      expect(one.json()).toMatchObject({ id: created.id, name: 'Design' });
    });

    it('answers 201 and falls back to the default emoji when none is given', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Ops' } });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'Ops', emoji: '📋' });
    });
  });

  describe('PATCH /api/boards/:id', () => {
    it('answers 200 with the new name and emoji', async () => {
      const board = await seedBoard(h.container, { name: 'Old', emoji: '📋' });

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/boards/${board.id}`,
        payload: { name: 'New', emoji: '✨' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: board.id, name: 'New', emoji: '✨' });

      const stored = await h.container.ticketStore.getBoardById(board.id);
      expect(stored?.name).toBe('New');
    });

    it('answers 404 BOARD_NOT_FOUND on an unknown id', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/boards/inconnu',
        payload: { name: 'Nope' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'BOARD_NOT_FOUND', message: 'Board not found: inconnu' });
    });
  });

  describe('DELETE /api/boards/:id', () => {
    it('answers 204 and cascades to the board tickets when another board remains', async () => {
      const doomed = await seedBoard(h.container, { name: 'Doomed' });
      const keeper = await seedBoard(h.container, { name: 'Keeper' });
      const victim = await seedTicket(h.container, { boardId: doomed.id, title: 'Goes away' });
      const survivor = await seedTicket(h.container, { boardId: keeper.id, title: 'Stays' });

      const res = await h.app.inject({ method: 'DELETE', url: `/api/boards/${doomed.id}` });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      // The cascade is the part that silently rots: an orphaned ticket is
      // invisible in the UI but still counted by every aggregate query.
      expect(await h.container.ticketStore.getBoardById(doomed.id)).toBeNull();
      expect(await h.container.ticketStore.getTicketById(victim.id)).toBeNull();
      expect(await h.container.ticketStore.getTicketById(survivor.id)).not.toBeNull();

      const list = await h.app.inject({ method: 'GET', url: '/api/boards' });
      expect(list.statusCode).toBe(200);
      expect((list.json() as Array<{ id: string }>).map((b) => b.id)).toEqual([keeper.id]);
    });

    it('answers 422 LAST_BOARD rather than deleting the only board', async () => {
      const only = await seedBoard(h.container, { name: 'Only' });

      const res = await h.app.inject({ method: 'DELETE', url: `/api/boards/${only.id}` });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'LAST_BOARD', message: 'Cannot delete the last board' });
      expect(await h.container.ticketStore.getBoardById(only.id)).not.toBeNull();
    });

    /**
     * The route used to skip the lookup entirely: it counted boards, then called
     * `removeTicketsByBoard` + `removeBoard`, both no-ops on an unknown id, and
     * answered 204 while emitting a phantom `board.deleted`. WS clients acted on
     * that event and dropped a card for a board that never existed.
     *
     * The event assertion is the point of this test, not the status: a 404 with
     * a `board.deleted` still on the bus would be just as wrong.
     */
    it('answers 404 on an unknown id and emits no board.deleted', async () => {
      await seedBoard(h.container, { name: 'A' });
      await seedBoard(h.container, { name: 'B' });

      const res = await h.app.inject({ method: 'DELETE', url: '/api/boards/inconnu' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'BOARD_NOT_FOUND' });
      expect(h.events.filter((e) => e.type === 'board.deleted')).toEqual([]);
    });
  });
});
