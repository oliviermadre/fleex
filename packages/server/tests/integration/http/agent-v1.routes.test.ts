import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TICKET_STATUSES } from '@fleex/shared';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import {
  seedBoard,
  seedTicket,
  seedComment,
  seedMention,
  seedDeliverable,
  seedAgentToken,
  agentAuth,
} from '../../helpers/fixtures.js';

/**
 * `/api/agents/v1/*` carries every automated interaction with Fleex — it is
 * the surface agents actually drive, and until this file it had zero tests.
 *
 * Everything here authenticates as `builder` through `x-agent-name`, because
 * most handlers key their behaviour off `request.agent.name`: comment
 * authorship, mention targeting, deliverable ownership, claim/unclaim. Several
 * assertions below are about a request being REFUSED for the wrong agent —
 * those are authorisation rules, not plumbing, and they are the reason the
 * identity is stated explicitly on every call.
 */
describe('agent API v1', () => {
  let h: TestAppHandle;
  let auth: Record<string, string>;
  let boardId: string;

  beforeEach(async () => {
    h = await createTestApp();
    const { secret } = await seedAgentToken(h.container, { name: 'ci-token' });
    auth = agentAuth(secret, 'builder');
    boardId = (await seedBoard(h.container, { name: 'Agent Board' })).id;
  });

  afterEach(async () => {
    await h.close();
  });

  // ── 37 · boards ─────────────────────────────────────────────────────────
  describe('GET /boards', () => {
    it('returns every board with a ticketCount for every known status', async () => {
      await seedTicket(h.container, { boardId, status: 'doing' });
      await seedTicket(h.container, { boardId, status: 'done' });

      const res = await h.app.inject({ method: 'GET', url: '/api/agents/v1/boards', headers: auth });
      expect(res.statusCode).toBe(200);

      const [board] = res.json();
      // Agents branch on these counters, so a status added to TICKET_STATUSES
      // without a counter here would silently read as `undefined`.
      expect(Object.keys(board.ticketCounts).sort()).toEqual([...TICKET_STATUSES].sort());
      expect(board.ticketCounts).toMatchObject({ doing: 1, done: 1, backlog: 0 });
    });
  });

  // ── 38–39 · read tickets ────────────────────────────────────────────────
  describe('GET /tickets', () => {
    it('returns every ticket with no filter', async () => {
      await seedTicket(h.container, { boardId, title: 'one' });
      await seedTicket(h.container, { boardId, title: 'two' });

      const res = await h.app.inject({ method: 'GET', url: '/api/agents/v1/tickets', headers: auth });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('filters by board_id', async () => {
      const other = await seedBoard(h.container, { name: 'Other' });
      await seedTicket(h.container, { boardId, title: 'mine' });
      await seedTicket(h.container, { boardId: other.id, title: 'theirs' });

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets?board_id=${boardId}`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((t: { title: string }) => t.title)).toEqual(['mine']);
    });

    it('filters by board_id + status', async () => {
      await seedTicket(h.container, { boardId, title: 'todo one', status: 'todo' });
      await seedTicket(h.container, { boardId, title: 'done one', status: 'done' });

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets?board_id=${boardId}&status=todo`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((t: { title: string }) => t.title)).toEqual(['todo one']);
    });
  });

  describe('GET /tickets/:id', () => {
    it('returns the ticket', async () => {
      const ticket = await seedTicket(h.container, { boardId, title: 'readable' });
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticket.id}`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: ticket.id, title: 'readable' });
    });

    it('answers 404 on an unknown id', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/agents/v1/tickets/nope',
        headers: auth,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });

  // ── 40–42 · write tickets ───────────────────────────────────────────────
  describe('POST /tickets', () => {
    it('creates a ticket and records the agent as the actor', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/agents/v1/tickets',
        headers: auth,
        payload: { boardId, title: 'from an agent' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ title: 'from an agent', status: 'backlog' });
      expect(res.json().displayId).toBeGreaterThan(0);

      const activities = await h.container.ticketStore.getActivitiesByTicket(res.json().id);
      expect(activities.map((a) => [a.action, a.actorName])).toEqual([['created', 'builder']]);
    });

    /**
     * Agents insert at the TOP of the column, not the bottom: work an agent
     * files is work it is about to pick up. A regression here is invisible in
     * the response body — only the position tells you.
     */
    it('inserts the ticket at the head of its column', async () => {
      await seedTicket(h.container, { boardId, status: 'backlog', position: 5 });

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/agents/v1/tickets',
        headers: auth,
        payload: { boardId, title: 'jumps the queue' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().position).toBe(4);
    });

    it('answers 404 when the board does not exist', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/agents/v1/tickets',
        headers: auth,
        payload: { boardId: 'nope', title: 'orphan' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'BOARD_NOT_FOUND' });
    });
  });

  describe('PATCH /tickets/:id', () => {
    it('updates the ticket and logs one activity', async () => {
      const ticket = await seedTicket(h.container, { boardId, title: 'before' });
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}`,
        headers: auth,
        payload: { title: 'after' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ title: 'after' });

      const activities = await h.container.ticketStore.getActivitiesByTicket(ticket.id);
      expect(activities.map((a) => a.action)).toEqual(['updated']);
    });

    /**
     * A no-op PATCH must not pollute the activity feed: agents poll and
     * re-PATCH liberally, and an entry per poll would drown the human reader.
     */
    it('logs nothing when the diff is empty', async () => {
      const ticket = await seedTicket(h.container, { boardId, title: 'same' });
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}`,
        headers: auth,
        payload: { title: 'same' },
      });
      expect(res.statusCode).toBe(200);
      expect(await h.container.ticketStore.getActivitiesByTicket(ticket.id)).toEqual([]);
    });

    it('answers 404 on an unknown id', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/agents/v1/tickets/nope',
        headers: auth,
        payload: { title: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  it('DELETE /tickets/:id answers 204 and removes the ticket', async () => {
    const ticket = await seedTicket(h.container, { boardId });
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/agents/v1/tickets/${ticket.id}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(204);
    expect(await h.container.ticketStore.getTicketById(ticket.id)).toBeNull();
  });

  // ── 43–44 · claim / complete ────────────────────────────────────────────
  describe('claim & unclaim', () => {
    it('claims for the calling agent, then releases', async () => {
      const ticket = await seedTicket(h.container, { boardId });

      const claimed = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}/claim`,
        headers: auth,
      });
      expect(claimed.statusCode).toBe(200);
      expect(claimed.json().assignee).toBe('builder');

      const unclaimed = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}/unclaim`,
        headers: auth,
      });
      expect(unclaimed.statusCode).toBe(200);
      expect(unclaimed.json().assignee).toBeNull();
    });
  });

  /**
   * `complete` is a TOGGLE, not a setter: calling it on a `done` ticket sends
   * it back to `doing`. That is easy to "simplify" into an idempotent setter
   * by accident, so both directions are pinned.
   */
  describe('PATCH /tickets/:id/complete', () => {
    it('moves backlog → done, then done → doing on a second call', async () => {
      const ticket = await seedTicket(h.container, { boardId, status: 'backlog' });

      const first = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}/complete`,
        headers: auth,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().status).toBe('done');

      const second = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}/complete`,
        headers: auth,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().status).toBe('doing');

      const moves = h.events.filter((e) => e.type === 'ticket.moved');
      expect(moves).toHaveLength(2);
      expect(moves[0]).toMatchObject({ fromStatus: 'backlog', toStatus: 'done' });
      expect(moves[1]).toMatchObject({ fromStatus: 'done', toStatus: 'doing' });
    });
  });

  // ── 45–46 · queues ──────────────────────────────────────────────────────
  describe('GET /tickets/next', () => {
    it('returns { ticket: null } when nothing is ready', async () => {
      // Seeded as `backlog`: only `todo` counts as ready to pick up.
      await seedTicket(h.container, { boardId, status: 'backlog' });
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/agents/v1/tickets/next',
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ticket: null });
    });

    it('returns the highest-priority todo ticket', async () => {
      await seedTicket(h.container, { boardId, title: 'low', status: 'todo', priority: 'low' });
      await seedTicket(h.container, { boardId, title: 'urgent', status: 'todo', priority: 'high' });

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/agents/v1/tickets/next',
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ticket).toMatchObject({ title: 'urgent' });
    });
  });

  /**
   * "Pending" means assigned to the caller AND in progress: `getClaimedByAgent`
   * filters on `status === 'doing'` as well as the assignee. A ticket parked in
   * `backlog` with the agent's name on it is deliberately NOT work in flight.
   */
  it('GET /tickets/pending returns only the doing tickets claimed by the caller', async () => {
    const mine = await seedTicket(h.container, {
      boardId,
      title: 'mine',
      assignee: 'builder',
      status: 'doing',
    });
    await seedTicket(h.container, {
      boardId,
      title: 'mine but not started',
      assignee: 'builder',
      status: 'backlog',
    });
    await seedTicket(h.container, {
      boardId,
      title: 'theirs',
      assignee: 'reviewer',
      status: 'doing',
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/agents/v1/tickets/pending',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((t: { id: string }) => t.id)).toEqual([mine.id]);
  });

  // ── 47 · settings ───────────────────────────────────────────────────────
  it('GET /settings echoes the calling agent', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/agents/v1/settings', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'builder', status: 'active' });
  });

  // ── 48–51 · comments ────────────────────────────────────────────────────
  describe('comments', () => {
    /**
     * Private comments are the mechanism agents use to talk past each other
     * without leaking context. A leak here is a confidentiality bug, not a
     * cosmetic one.
     */
    it('hides a private comment addressed to another agent', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      await seedComment(h.container, { ticketId: ticket.id, body: 'everyone' });
      await seedComment(h.container, {
        ticketId: ticket.id,
        body: 'for the reviewer only',
        visibility: 'private',
        authorName: 'planner',
        privateRecipients: ['reviewer'],
      });

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticket.id}/comments`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((c: { body: string }) => c.body)).toEqual(['everyone']);
    });

    it('shows a private comment when the caller is a recipient', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      await seedComment(h.container, {
        ticketId: ticket.id,
        body: 'for the builder',
        visibility: 'private',
        authorName: 'planner',
        privateRecipients: ['builder'],
      });

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticket.id}/comments`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
    });

    it('applies the visibility, parentId and limit filters', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const parent = await seedComment(h.container, { ticketId: ticket.id, body: 'parent' });
      await seedComment(h.container, { ticketId: ticket.id, body: 'child', parentId: parent.id });
      await seedComment(h.container, {
        ticketId: ticket.id,
        body: 'private to me',
        visibility: 'private',
        privateRecipients: ['builder'],
      });

      const byParent = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticket.id}/comments?parentId=${parent.id}`,
        headers: auth,
      });
      expect(byParent.statusCode).toBe(200);
      expect(byParent.json().map((c: { body: string }) => c.body)).toEqual(['child']);

      const byVisibility = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticket.id}/comments?visibility=private`,
        headers: auth,
      });
      expect(byVisibility.statusCode).toBe(200);
      expect(byVisibility.json().map((c: { body: string }) => c.body)).toEqual(['private to me']);

      const limited = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticket.id}/comments?limit=1`,
        headers: auth,
      });
      expect(limited.statusCode).toBe(200);
      expect(limited.json()).toHaveLength(1);
    });

    it('answers 404 listing comments on an unknown ticket', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/agents/v1/tickets/nope/comments',
        headers: auth,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });

    /**
     * NO AGENT-TO-AGENT CHAINING. `PostCommentUseCase` skips mention creation
     * entirely when `authorType === 'agent'`, so `@agent:reviewer` written by
     * an agent is inert text. This is the guard that stops agents summoning
     * each other in an unbounded loop, and it is invisible from the response
     * body alone — `createdMentions` is simply `[]`.
     *
     * Deleting that guard would not break any other test in the repo. It
     * breaks this one.
     */
    it('posts a comment WITHOUT creating a mention (no agent-to-agent chaining)', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/agents/v1/tickets/${ticket.id}/comments`,
        headers: auth,
        payload: { body: 'handing over to @agent:reviewer' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ authorName: 'builder', authorType: 'agent' });
      expect(res.json().createdMentions).toEqual([]);
      expect(await h.container.mentionStore.getByTicket(ticket.id)).toEqual([]);
    });

    /**
     * The counterpart: the SAME body posted by a human on the human route does
     * create the mention. Without this pairing, the assertion above could pass
     * simply because mention extraction is broken everywhere.
     */
    it('does create the mention when the same body comes from a human', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticket.id}/comments`,
        payload: { body: 'handing over to @agent:reviewer', authorName: 'nas' },
      });
      expect(res.statusCode).toBe(201);

      const mentions = await h.container.mentionStore.getByTicket(ticket.id);
      expect(mentions.map((m) => m.targetAgent)).toEqual(['reviewer']);
    });

    it('answers 404 posting to an unknown ticket', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/agents/v1/tickets/nope/comments',
        headers: auth,
        payload: { body: 'hello' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('lets the author edit, and refuses anyone else with 403', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const mine = await seedComment(h.container, {
        ticketId: ticket.id,
        authorName: 'builder',
        authorType: 'agent',
        body: 'draft',
      });
      const theirs = await seedComment(h.container, {
        ticketId: ticket.id,
        authorName: 'planner',
        authorType: 'agent',
        body: 'not yours',
      });

      const edited = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}/comments/${mine.id}`,
        headers: auth,
        payload: { body: 'final' },
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json().body).toBe('final');

      const refused = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}/comments/${theirs.id}`,
        headers: auth,
        payload: { body: 'hijacked' },
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: 'FORBIDDEN' });

      const missing = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}/comments/nope`,
        headers: auth,
        payload: { body: 'x' },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: 'COMMENT_NOT_FOUND' });
    });

    it('lets the author delete, and refuses anyone else with 403', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const mine = await seedComment(h.container, {
        ticketId: ticket.id,
        authorName: 'builder',
        authorType: 'agent',
      });
      const theirs = await seedComment(h.container, {
        ticketId: ticket.id,
        authorName: 'planner',
        authorType: 'agent',
      });

      const deleted = await h.app.inject({
        method: 'DELETE',
        url: `/api/agents/v1/tickets/${ticket.id}/comments/${mine.id}`,
        headers: auth,
      });
      expect(deleted.statusCode).toBe(204);

      const refused = await h.app.inject({
        method: 'DELETE',
        url: `/api/agents/v1/tickets/${ticket.id}/comments/${theirs.id}`,
        headers: auth,
      });
      expect(refused.statusCode).toBe(403);
      expect(await h.container.commentStore.getById(theirs.id)).not.toBeNull();
    });
  });

  // ── 52–55 · mentions ────────────────────────────────────────────────────
  describe('mentions', () => {
    it('GET /mentions/pending returns only mentions aimed at the caller', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const mine = await seedMention(h.container, { ticketId: ticket.id, targetAgent: 'builder' });
      await seedMention(h.container, { ticketId: ticket.id, targetAgent: 'reviewer' });

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/agents/v1/mentions/pending',
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((m: { id: string }) => m.id)).toEqual([mine.id]);
    });

    it('GET /mentions/pending honours the ticket_id filter', async () => {
      const a = await seedTicket(h.container, { boardId, title: 'a' });
      const b = await seedTicket(h.container, { boardId, title: 'b' });
      const onA = await seedMention(h.container, { ticketId: a.id, targetAgent: 'builder' });
      await seedMention(h.container, { ticketId: b.id, targetAgent: 'builder' });

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/mentions/pending?ticket_id=${a.id}`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((m: { id: string }) => m.id)).toEqual([onA.id]);
    });

    it('acknowledges a mention, refuses one aimed elsewhere with 403', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const mine = await seedMention(h.container, { ticketId: ticket.id, targetAgent: 'builder' });
      const theirs = await seedMention(h.container, { ticketId: ticket.id, targetAgent: 'reviewer' });

      const ok = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/mentions/${mine.id}/acknowledge`,
        headers: auth,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().status).toBe('acknowledged');

      const refused = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/mentions/${theirs.id}/acknowledge`,
        headers: auth,
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: 'FORBIDDEN' });

      const missing = await h.app.inject({
        method: 'PATCH',
        url: '/api/agents/v1/mentions/nope/acknowledge',
        headers: auth,
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: 'MENTION_NOT_FOUND' });
    });

    it('resolves a mention', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const mention = await seedMention(h.container, { ticketId: ticket.id, targetAgent: 'builder' });

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/mentions/${mention.id}/resolve`,
        headers: auth,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('resolved');
    });

    /**
     * `waitForInfo()` only fires from `acknowledged` — the real agent flow is
     * acknowledge, work, then park. Hence the acknowledge call first.
     */
    it('marks an acknowledged mention as waiting for info, refusing the wrong agent with 403', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const mine = await seedMention(h.container, { ticketId: ticket.id, targetAgent: 'builder' });
      const theirs = await seedMention(h.container, { ticketId: ticket.id, targetAgent: 'reviewer' });

      await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/mentions/${mine.id}/acknowledge`,
        headers: auth,
      });

      const ok = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/mentions/${mine.id}/wait-for-info`,
        headers: auth,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().status).toBe('waiting_for_info');

      const refused = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/mentions/${theirs.id}/wait-for-info`,
        headers: auth,
      });
      expect(refused.statusCode).toBe(403);
    });

    /**
     * ⚠️  SHARP EDGE, LOCKED ON PURPOSE.
     *
     * The state machine ignores `waitForInfo()` from `pending`, but the route
     * still answers **200** with the untouched mention. A caller that parks a
     * mention it never acknowledged is told it succeeded while the mention
     * stays `pending` and gets re-dispatched.
     *
     * Arguably this should be a 409. It is locked as-is here; changing it is
     * its own ticket, so the change shows up as a deliberate red→green diff.
     */
    it('answers 200 but does nothing when the mention is still pending', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const mention = await seedMention(h.container, { ticketId: ticket.id, targetAgent: 'builder' });

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/mentions/${mention.id}/wait-for-info`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('pending');
    });

    /**
     * `waiting_for_info` and `resolved` both drop out of the pending queue —
     * that is what stops an agent re-answering a question it already parked.
     */
    it('drops a waiting_for_info mention out of the pending queue', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const mention = await seedMention(h.container, { ticketId: ticket.id, targetAgent: 'builder' });

      await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/mentions/${mention.id}/acknowledge`,
        headers: auth,
      });
      await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/mentions/${mention.id}/wait-for-info`,
        headers: auth,
      });

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/agents/v1/mentions/pending',
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── 56 · context ────────────────────────────────────────────────────────
  it('GET /tickets/:id/context returns the ticket with its comments and deliverables', async () => {
    const ticket = await seedTicket(h.container, { boardId, title: 'contextual' });
    await seedComment(h.container, { ticketId: ticket.id, body: 'a note' });
    await seedDeliverable(h.container, { ticketId: ticket.id, title: 'a report' });

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/agents/v1/tickets/${ticket.id}/context`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ticket).toMatchObject({ id: ticket.id, title: 'contextual' });
    expect(body.comments).toHaveLength(1);
    expect(body.deliverables).toHaveLength(1);
  });

  // ── 57 · deliverables ───────────────────────────────────────────────────
  describe('deliverables', () => {
    it('submits, lists and deletes', async () => {
      const ticket = await seedTicket(h.container, { boardId });

      const created = await h.app.inject({
        method: 'POST',
        url: `/api/agents/v1/tickets/${ticket.id}/deliverables`,
        headers: auth,
        payload: { type: 'report', title: 'Findings', content: '# Findings' },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ title: 'Findings', agentName: 'builder' });

      const listed = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticket.id}/deliverables`,
        headers: auth,
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toHaveLength(1);

      const removed = await h.app.inject({
        method: 'DELETE',
        url: `/api/agents/v1/tickets/${ticket.id}/deliverables/${created.json().id}`,
        headers: auth,
      });
      expect(removed.statusCode).toBe(204);
      expect(await h.container.deliverableStore.getById(created.json().id)).toBeNull();
    });

    it('refuses to update another agent deliverable with 403', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const theirs = await seedDeliverable(h.container, {
        ticketId: ticket.id,
        agentName: 'planner',
      });

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/agents/v1/tickets/${ticket.id}/deliverables/${theirs.id}`,
        headers: auth,
        payload: { title: 'hijacked' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
    });

    it('answers 404 on an unknown deliverable', async () => {
      const ticket = await seedTicket(h.container, { boardId });
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/agents/v1/tickets/${ticket.id}/deliverables/nope`,
        headers: auth,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'DELIVERABLE_NOT_FOUND' });
    });
  });
});
