import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedBoard, seedTicket, seedDeliverable } from '../../helpers/fixtures.js';
import type { TicketDeliverableEntity } from '../../../src/domain/entities/ticket-deliverable.entity.js';

/**
 * HTTP contract of the web deliverable routes of `tickets.routes.ts`:
 *
 *   GET  /api/tickets/:id/deliverables
 *   POST /api/tickets/:id/deliverables
 *
 * The POST route is the only one that can answer 400: `SubmitDeliverableUseCase`
 * validates `type` against the workspace's configured deliverable types and
 * raises `INVALID_DELIVERABLE_TYPE`, which `CODE_TO_STATUS` maps to 400. That
 * mapping is a real product decision (an agent posting a typo'd type must be
 * told, not silently stored), so it gets its own case here on top of the
 * table-driven check in error-handler.test.ts.
 *
 * A fresh test container never customises `deliverableTypes`, so
 * `normalizeDeliverableTypes` falls back to DEFAULT_DELIVERABLE_TYPES — 'report'
 * and 'spec' below are valid, 'not-a-real-type' is not.
 */

/**
 * `seedDeliverable` stamps `createdAt = new Date()`; two seeds in a row can land
 * in the same millisecond, and the store's sort would then be indistinguishable
 * from insertion order. Back-dating makes the ordering assertion mean something.
 */
async function backdate(
  h: TestAppHandle,
  deliverable: TicketDeliverableEntity,
  isoDate: string,
): Promise<TicketDeliverableEntity> {
  (deliverable as { createdAt: Date }).createdAt = new Date(isoDate);
  await h.container.deliverableStore.save(deliverable);
  return deliverable;
}

describe('deliverable routes (web)', () => {
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

  describe('GET /api/tickets/:id/deliverables', () => {
    it('answers 200 with an empty array when the ticket has none', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/deliverables` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('answers 200 with the ticket’s deliverables, oldest-first', async () => {
      const ticketId = await aTicket();
      const newer = await backdate(
        h,
        await seedDeliverable(h.container, { ticketId, title: 'Newer', type: 'spec' }),
        '2024-02-02T00:00:00.000Z',
      );
      const older = await backdate(
        h,
        await seedDeliverable(h.container, { ticketId, title: 'Older', type: 'report' }),
        '2024-02-01T00:00:00.000Z',
      );

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/deliverables` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; title: string; type: string; status: string; version: number }>;
      expect(body.map((d) => d.id)).toEqual([older.id, newer.id]);
      expect(body[0]).toMatchObject({ title: 'Older', type: 'report', status: 'draft', version: 1 });
    });

    it('answers 200 and never leaks another ticket’s deliverables', async () => {
      const mine = await aTicket();
      const theirs = await aTicket();
      const ours = await seedDeliverable(h.container, { ticketId: mine, title: 'Mine' });
      await seedDeliverable(h.container, { ticketId: theirs, title: 'Theirs' });

      const res = await h.app.inject({ method: 'GET', url: `/api/tickets/${mine}/deliverables` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject([{ id: ours.id, title: 'Mine' }]);
    });

    it('answers 404 TICKET_NOT_FOUND on an unknown ticket', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/tickets/nope/deliverables' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });

  describe('POST /api/tickets/:id/deliverables', () => {
    it('answers 201 with the created deliverable and persists it', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/deliverables`,
        payload: { title: 'Audit', type: 'report', content: '# Findings' },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json() as { id: string; title: string; type: string; content: string; agentName: string; status: string; version: number };
      expect(created).toMatchObject({
        ticketId,
        title: 'Audit',
        type: 'report',
        content: '# Findings',
        // The web route stamps 'user' when the payload names no agent, and the
        // entity defaults to a draft at version 1.
        agentName: 'user',
        status: 'draft',
        version: 1,
      });

      const stored = await h.container.deliverableStore.getById(created.id);
      expect(stored?.title).toBe('Audit');
    });

    it('answers 201 honouring an explicit agentName and status', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/deliverables`,
        payload: { title: 'Spec v1', type: 'spec', content: 'body', agentName: 'architect', status: 'final' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ agentName: 'architect', status: 'final', type: 'spec' });
    });

    it('emits a deliverable.created event carrying the new id', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/deliverables`,
        payload: { title: 'Plan', type: 'plan', content: 'steps' },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json() as { id: string };
      expect(h.events.filter((e) => e.type === 'deliverable.created')).toMatchObject([
        { deliverableId: created.id, ticketId, agentName: 'user', title: 'Plan', status: 'draft' },
      ]);
    });

    it('answers 400 INVALID_DELIVERABLE_TYPE on a type outside the configured set', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/deliverables`,
        payload: { title: 'Oops', type: 'not-a-real-type', content: 'x' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: 'INVALID_DELIVERABLE_TYPE',
        message: 'Invalid deliverable type: not-a-real-type',
      });

      // Rejected means rejected: nothing was written, nothing was announced.
      const after = await h.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/deliverables` });
      expect(after.statusCode).toBe(200);
      expect(after.json()).toEqual([]);
      expect(h.events.filter((e) => e.type === 'deliverable.created')).toEqual([]);
    });

    /**
     * A system type (ticket-summary / cli-session-summary) is not offered to
     * agents in the UI, but `normalizeDeliverableTypes` keeps it in the valid
     * set, so the route accepts it. Locked so that hardening this into a 400
     * would be a conscious decision rather than a surprise.
     */
    it('answers 201 on a system deliverable type', async () => {
      const ticketId = await aTicket();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/deliverables`,
        payload: { title: 'Summary', type: 'ticket-summary', content: 'tl;dr' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ type: 'ticket-summary' });
    });

    it('answers 404 TICKET_NOT_FOUND on an unknown ticket', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/tickets/nope/deliverables',
        payload: { title: 'Audit', type: 'report', content: 'x' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'TICKET_NOT_FOUND' });
    });
  });
});
