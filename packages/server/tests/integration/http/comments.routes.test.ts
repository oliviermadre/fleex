import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedBoard, seedTicket, seedComment, seedMention } from '../../helpers/fixtures.js';
import type { TicketCommentEntity } from '../../../src/domain/entities/ticket-comment.entity.js';

/**
 * HTTP contract of the three web comment routes of `tickets.routes.ts`:
 *
 *   GET    /api/tickets/:id/comments
 *   POST   /api/tickets/:id/comments
 *   DELETE /api/tickets/:id/comments/:commentId
 *
 * Every case asserts the status code first — a route silently changing 201 to
 * 200 (or a `throw` losing its mapping and becoming a 500) is exactly the
 * regression this suite exists to catch.
 *
 * NOTE on mentions: the test container constructs `DomainEventListener` but
 * never registers it, so posting `@agent:x` CREATES a mention row and emits the
 * events, but dispatches nothing. Asserting "a mention exists" is therefore
 * safe; asserting "an agent ran" would require a real Claude SDK execution and
 * is deliberately out of reach here.
 */

/**
 * `seedComment` stamps `createdAt = new Date()`, so three comments seeded in a
 * row can share the same millisecond. The store sorts on that field, and a
 * stable sort would then leave them in insertion order — the ordering assertion
 * would pass even if the sort were removed. Back-dating each comment to a
 * distinct instant AND inserting them out of order makes the assertion real.
 */
async function backdate(
  h: TestAppHandle,
  comment: TicketCommentEntity,
  isoDate: string,
): Promise<TicketCommentEntity> {
  (comment as { createdAt: Date }).createdAt = new Date(isoDate);
  await h.container.commentStore.save(comment);
  return comment;
}

describe('comment routes (web)', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  async function aTicket(): Promise<string> {
    const board = await seedBoard(h.container);
    const ticket = await seedTicket(h.container, { boardId: board.id });
    return ticket.id;
  }

  describe('GET /api/tickets/:id/comments', () => {
    it('answers 200 with an empty array when the ticket has no comment', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/comments` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 and returns the comments oldest-first', async () => {
      const ticketId = await aTicket();

      // Inserted middle → newest → oldest on purpose: the response order can
      // only be right if the route really sorts by createdAt.
      const second = await backdate(
        h,
        await seedComment(h.container, { ticketId, body: 'second' }),
        '2024-01-02T00:00:00.000Z',
      );
      const third = await backdate(
        h,
        await seedComment(h.container, { ticketId, body: 'third' }),
        '2024-01-03T00:00:00.000Z',
      );
      const first = await backdate(
        h,
        await seedComment(h.container, { ticketId, body: 'first' }),
        '2024-01-01T00:00:00.000Z',
      );

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/comments` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; body: string; createdAt: string }>;
      expect(body.map((c) => c.body)).toEqual(['first', 'second', 'third']);
      expect(body.map((c) => c.id)).toEqual([first.id, second.id, third.id]);
      expect(body[0]?.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('answers 200 and hides a private comment the human is not a recipient of', async () => {
      const ticketId = await aTicket();
      const visible = await seedComment(h.container, { ticketId, body: 'everyone sees this' });
      const hidden = await seedComment(h.container, {
        ticketId,
        authorType: 'agent',
        authorName: 'builder',
        body: 'agents only',
        visibility: 'private',
        privateRecipients: ['reviewer'],
      });

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/comments` });

      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Array<{ id: string }>).map((c) => c.id);
      expect(ids).toContain(visible.id);
      expect(ids).not.toContain(hidden.id);
    });

    it('answers 404 TICKET_NOT_FOUND on an unknown ticket', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/tickets/nope/comments' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });

  describe('POST /api/tickets/:id/comments', () => {
    it('answers 201 with the created comment and persists it', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/comments`,
        payload: { body: 'looks good to me' },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json() as { id: string; body: string; authorType: string; authorName: string };
      expect(created.body).toBe('looks good to me');
      expect(created.authorType).toBe('user');
      // No `humanDisplayName` / `humanMentionName` in a fresh config → 'user'.
      expect(created.authorName).toBe('user');

      const stored = await h.container.commentStore.getById(created.id);
      expect(stored?.body).toBe('looks good to me');
    });

    it('emits a comment.posted event carrying the new comment id', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/comments`,
        payload: { body: 'hello bus' },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json() as { id: string };
      const posted = h.events.filter((e) => e.type === 'comment.posted');
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({
        type: 'comment.posted',
        commentId: created.id,
        ticketId,
        authorType: 'user',
        createdMentions: [],
      });
    });

    it('answers 201 and creates a mention for @agent:x, visible on GET .../mentions', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/comments`,
        payload: { body: '@agent:builder please take a look' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ mentions: ['builder'] });

      const mentions = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/mentions` });
      expect(mentions.statusCode).toBe(200);
      const list = mentions.json() as Array<{ targetAgent: string; targetType: string; status: string; commentId: string }>;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        targetAgent: 'builder',
        targetType: 'agent',
        status: 'pending',
        commentId: (res.json() as { id: string }).id,
      });

      // The mention is announced on the bus twice over: once inside
      // comment.posted, once as its own mention.created.
      expect(h.events.filter((e) => e.type === 'mention.created')).toHaveLength(1);
      const posted = h.events.find((e) => e.type === 'comment.posted');
      expect(posted).toMatchObject({
        createdMentions: [{ targetAgent: 'builder', targetType: 'agent' }],
      });
    });

    it('answers 201 and creates no mention for a struck-through ~~@agent:x~~', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/comments`,
        payload: { body: 'cancelled: ~~@agent:builder~~' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ mentions: [] });

      const mentions = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/mentions` });
      expect(mentions.statusCode).toBe(200);
      expect(mentions.json()).toEqual([]);
    });

    it('answers 404 TICKET_NOT_FOUND on an unknown ticket', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/tickets/nope/comments',
        payload: { body: 'into the void' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });

  describe('DELETE /api/tickets/:id/comments/:commentId', () => {
    it('answers 204 with an empty body and removes the comment', async () => {
      const ticketId = await aTicket();
      const comment = await seedComment(h.container, { ticketId, body: 'to be deleted' });

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/tickets/${ticketId}/comments/${comment.id}`,
      });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      const after = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/comments` });
      expect(after.statusCode).toBe(200);
      expect(after.json()).toEqual([]);
      expect(h.events.filter((e) => e.type === 'comment.deleted')).toMatchObject([
        { commentId: comment.id, ticketId },
      ]);
    });

    it('answers 204 and resolves the mentions the comment carried', async () => {
      const ticketId = await aTicket();
      const comment = await seedComment(h.container, { ticketId, body: '@agent:builder ping' });
      const mention = await seedMention(h.container, {
        ticketId,
        commentId: comment.id,
        targetAgent: 'builder',
      });

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/tickets/${ticketId}/comments/${comment.id}`,
      });

      expect(res.statusCode).toBe(204);
      // The mention row survives its comment — only its status changes, so the
      // agent's pending work does not silently disappear from the cockpit.
      const mentions = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/mentions` });
      expect(mentions.statusCode).toBe(200);
      expect(mentions.json()).toMatchObject([{ id: mention.id, status: 'resolved' }]);
    });

    /**
     * The handler used to look the comment up by `:commentId` alone, never
     * checking it belonged to `:id`. A foreign — or plainly nonexistent —
     * ticket id therefore deleted the comment anyway. The route is scoped by
     * ticket, so a comment from another ticket is simply not addressable here.
     *
     * The `getById` assertion matters as much as the status: answering 404
     * while still deleting the row would be strictly worse than the old bug.
     */
    it('answers 404 and deletes nothing when :id is not the comment’s ticket', async () => {
      const ticketId = await aTicket();
      const comment = await seedComment(h.container, { ticketId, body: 'orphan-able' });

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/tickets/some-other-ticket/comments/${comment.id}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'COMMENT_NOT_FOUND' });
      expect(await h.container.commentStore.getById(comment.id)).not.toBeNull();
    });

    it('answers 404 COMMENT_NOT_FOUND on an unknown comment', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/tickets/${ticketId}/comments/nope`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'COMMENT_NOT_FOUND' });
    });
  });
});
