import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedBoard, seedTicket, seedMention, seedAgentToken, agentAuth } from '../../helpers/fixtures.js';
import type { TicketMentionEntity } from '../../../src/domain/entities/ticket-mention.entity.js';

/**
 * `GET .../tickets/:id/mentions` exists TWICE, with two different contracts:
 *
 *   - web   → `/api/tickets/:id/mentions`            (tickets.routes.ts)
 *             no query handling at all: every mention of the ticket, always.
 *   - agent → `/api/agents/v1/tickets/:id/mentions`  (agent-mentions.routes.ts)
 *             behind the agent auth hook, and the one that implements the
 *             `status` / `target_agent` / `source_agent` filters.
 *
 * Both are covered below: the filters are exercised where they exist, and the
 * web route's indifference to the same query string is locked so that adding
 * filtering there becomes a visible, deliberate change.
 */

/**
 * `seedMention` stamps `createdAt = new Date()`, so mentions seeded back to back
 * can share a millisecond and the store's sort would be indistinguishable from
 * insertion order. Back-dating gives the ordering assertion teeth.
 */
async function backdate(
  h: TestAppHandle,
  mention: TicketMentionEntity,
  isoDate: string,
): Promise<TicketMentionEntity> {
  (mention as { createdAt: Date }).createdAt = new Date(isoDate);
  await h.container.mentionStore.save(mention);
  return mention;
}

/** `status` is a plain mutable field; the entity's transitions are guarded, so we set it directly. */
async function withStatus(
  h: TestAppHandle,
  mention: TicketMentionEntity,
  status: TicketMentionEntity['status'],
): Promise<TicketMentionEntity> {
  mention.status = status;
  await h.container.mentionStore.save(mention);
  return mention;
}

describe('mention routes', () => {
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

  /**
   * Four mentions on one ticket, spanning two targets × two statuses, so every
   * filter assertion below can name both an included AND an excluded row.
   */
  async function aMixedTicket(): Promise<{
    ticketId: string;
    alicePending: TicketMentionEntity;
    aliceResolved: TicketMentionEntity;
    bobPending: TicketMentionEntity;
    bobResolved: TicketMentionEntity;
  }> {
    const ticketId = await aTicket();
    const alicePending = await backdate(
      h,
      await seedMention(h.container, { ticketId, targetAgent: 'alice' }),
      '2024-03-01T00:00:00.000Z',
    );
    const bobPending = await backdate(
      h,
      await seedMention(h.container, { ticketId, targetAgent: 'bob' }),
      '2024-03-02T00:00:00.000Z',
    );
    const aliceResolved = await withStatus(
      h,
      await backdate(
        h,
        await seedMention(h.container, { ticketId, targetAgent: 'alice' }),
        '2024-03-03T00:00:00.000Z',
      ),
      'resolved',
    );
    const bobResolved = await withStatus(
      h,
      await backdate(
        h,
        await seedMention(h.container, { ticketId, targetAgent: 'bob' }),
        '2024-03-04T00:00:00.000Z',
      ),
      'resolved',
    );
    return { ticketId, alicePending, aliceResolved, bobPending, bobResolved };
  }

  describe('GET /api/tickets/:id/mentions (web)', () => {
    it('answers 200 with an empty array when the ticket has no mention', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/mentions` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 with the full mention DTO, oldest-first', async () => {
      const ticketId = await aTicket();
      const second = await backdate(
        h,
        await seedMention(h.container, { ticketId, targetAgent: 'bob', sourceAgent: 'alice' }),
        '2024-03-02T00:00:00.000Z',
      );
      const first = await backdate(
        h,
        await seedMention(h.container, { ticketId, targetAgent: 'alice', sourceAgent: 'user' }),
        '2024-03-01T00:00:00.000Z',
      );

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/mentions` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; targetAgent: string }>;
      expect(body.map((m) => m.id)).toEqual([first.id, second.id]);
      expect(body[0]).toMatchObject({
        id: first.id,
        ticketId,
        targetAgent: 'alice',
        sourceAgent: 'user',
        targetType: 'agent',
        executionMode: 'plan',
        status: 'pending',
        resolvedAt: null,
      });
    });

    it('answers 200 and never leaks another ticket’s mentions', async () => {
      const mine = await aTicket();
      const theirs = await aTicket();
      const ours = await seedMention(h.container, { ticketId: mine, targetAgent: 'alice' });
      await seedMention(h.container, { ticketId: theirs, targetAgent: 'alice' });

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${mine}/mentions` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject([{ id: ours.id, ticketId: mine }]);
    });

    /**
     * The web handler reads `request.params` only — it declares no
     * `Querystring` and filters nothing. `status` / `target_agent` are silently
     * ignored, so a caller expecting a subset gets the whole list.
     *
     * Not currently a live defect: `packages/web/src/services/api.ts` calls this
     * route without any query string, and the filtering contract lives on the
     * agent route below. Locked so that the day someone adds filtering here (or
     * a frontend starts relying on it) the change is explicit.
     */
    it('answers 200 and IGNORES status / target_agent query filters', async () => {
      const { ticketId, alicePending, aliceResolved, bobPending, bobResolved } = await aMixedTicket();

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/tickets/${ticketId}/mentions`,
        query: { status: 'pending', target_agent: 'alice' },
      });

      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Array<{ id: string }>).map((m) => m.id);
      expect(ids).toEqual([alicePending.id, bobPending.id, aliceResolved.id, bobResolved.id]);
    });

    it('answers 404 TICKET_NOT_FOUND on an unknown ticket', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/tickets/nope/mentions' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });

  describe('GET /api/agents/v1/tickets/:id/mentions (agent scope — the filtering one)', () => {
    let auth: Record<string, string>;

    beforeEach(async () => {
      const { secret } = await seedAgentToken(h.container, { name: 'alice' });
      auth = agentAuth(secret, 'alice');
    });

    it('answers 200 with every mention when no filter is given', async () => {
      const { ticketId } = await aMixedTicket();

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticketId}/mentions`,
        headers: auth,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(4);
    });

    it('answers 200 and keeps only ?status=pending', async () => {
      const { ticketId, alicePending, aliceResolved, bobPending, bobResolved } = await aMixedTicket();

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticketId}/mentions`,
        query: { status: 'pending' },
        headers: auth,
      });

      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Array<{ id: string; status: string }>).map((m) => m.id);
      expect(ids).toEqual([alicePending.id, bobPending.id]);
      expect(ids).not.toContain(aliceResolved.id);
      expect(ids).not.toContain(bobResolved.id);
    });

    it('answers 200 and keeps only ?target_agent=alice', async () => {
      const { ticketId, alicePending, aliceResolved, bobPending, bobResolved } = await aMixedTicket();

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticketId}/mentions`,
        query: { target_agent: 'alice' },
        headers: auth,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; targetAgent: string }>;
      expect(body.map((m) => m.id)).toEqual([alicePending.id, aliceResolved.id]);
      expect(body.every((m) => m.targetAgent === 'alice')).toBe(true);
      expect(body.map((m) => m.id)).not.toContain(bobPending.id);
      expect(body.map((m) => m.id)).not.toContain(bobResolved.id);
    });

    it('answers 200 and ANDs status with target_agent', async () => {
      const { ticketId, alicePending, aliceResolved, bobPending, bobResolved } = await aMixedTicket();

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticketId}/mentions`,
        query: { status: 'pending', target_agent: 'alice' },
        headers: auth,
      });

      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Array<{ id: string }>).map((m) => m.id);
      expect(ids).toEqual([alicePending.id]);
      for (const excluded of [aliceResolved.id, bobPending.id, bobResolved.id]) {
        expect(ids).not.toContain(excluded);
      }
    });

    it('answers 200 with an empty array when no mention matches', async () => {
      const { ticketId } = await aMixedTicket();

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticketId}/mentions`,
        query: { target_agent: 'nobody' },
        headers: auth,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 and filters on ?source_agent too', async () => {
      const ticketId = await aTicket();
      const fromUser = await seedMention(h.container, { ticketId, targetAgent: 'alice', sourceAgent: 'user' });
      const fromBot = await seedMention(h.container, { ticketId, targetAgent: 'alice', sourceAgent: 'bot' });

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticketId}/mentions`,
        query: { source_agent: 'user' },
        headers: auth,
      });

      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Array<{ id: string }>).map((m) => m.id);
      expect(ids).toEqual([fromUser.id]);
      expect(ids).not.toContain(fromBot.id);
    });

    it('answers 404 TICKET_NOT_FOUND on an unknown ticket', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/agents/v1/tickets/nope/mentions',
        headers: auth,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });

    it('answers 401 without a token — the ticket id is never even resolved', async () => {
      const { ticketId } = await aMixedTicket();

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticketId}/mentions`,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'API_TOKEN_INVALID' });
    });
  });
});
