import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ticketRoutes } from '../../src/infrastructure/http/tickets.routes.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

/**
 * The ticket Timeline rebuilds a ticket's status zones from its `moved`
 * activities. Two gaps made that history incomplete:
 *  - the activity route only ever returned the latest 50 rows, so the first
 *    moves of a busy ticket fell off the page;
 *  - a Kanban drag across columns (POST /tickets/reorder) changed the status
 *    without logging anything, so those moves never existed at all.
 */

const TICKET_ID = 'a3c8a1b2-6a3e-4c11-9d7e-1f0f5e6b7c01';

let app: FastifyInstance;
let base: string;
let ticket: TicketEntity;
let activities: { action: string; changes: Record<string, unknown>; actorType: string; source: string }[];
let requestedLimits: (number | undefined)[];

beforeEach(async () => {
  activities = [];
  requestedLimits = [];
  ticket = TicketEntity.create({ id: TICKET_ID, boardId: 'b-1', displayId: 591, title: 'timeline', status: 'todo' });

  const container = {
    ticketStore: {
      getTicketById: async () => ticket,
      saveTicket: async () => {},
      saveActivity: async (a: { toDTO: () => (typeof activities)[number] }) => {
        activities.push(a.toDTO());
      },
      getActivitiesByTicket: async (_id: string, limit?: number) => {
        requestedLimits.push(limit);
        return [];
      },
    },
    eventBus: { emit: () => {} },
    logger: new FakeLoggerPort(),
    ticketBroadcast: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  app = Fastify({ logger: false });
  await app.register(ticketRoutes(container));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/tickets/:id/activity', () => {
  it('keeps the store default page when no limit is asked (other callers unchanged)', async () => {
    await fetch(`${base}/api/tickets/${TICKET_ID}/activity`);
    expect(requestedLimits).toEqual([undefined]);
  });

  it('passes an explicit limit through so the whole history can be read', async () => {
    await fetch(`${base}/api/tickets/${TICKET_ID}/activity?limit=1000`);
    expect(requestedLimits).toEqual([1000]);
  });

  it('clamps the limit to [1, 1000] and ignores garbage', async () => {
    await fetch(`${base}/api/tickets/${TICKET_ID}/activity?limit=99999`);
    await fetch(`${base}/api/tickets/${TICKET_ID}/activity?limit=0`);
    await fetch(`${base}/api/tickets/${TICKET_ID}/activity?limit=abc`);
    expect(requestedLimits).toEqual([1000, 1, undefined]);
  });
});

describe('POST /api/tickets/reorder', () => {
  it('logs a `moved` activity when a drag changes the column', async () => {
    const res = await fetch(`${base}/api/tickets/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates: [{ id: TICKET_ID, status: 'doing', position: 3 }] }),
    });
    expect(res.status).toBe(200);
    const moved = activities.filter((a) => a.action === 'moved');
    expect(moved).toHaveLength(1);
    // Same shape as every other move — what the Timeline reads.
    expect(moved[0]!.changes.status).toEqual({ from: 'todo', to: 'doing' });
    expect(moved[0]!.actorType).toBe('user');
    expect(moved[0]!.source).toBe('web');
  });

  it('writes nothing for a reorder inside the same column', async () => {
    await fetch(`${base}/api/tickets/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates: [{ id: TICKET_ID, status: 'todo', position: 7 }] }),
    });
    expect(activities).toEqual([]);
  });
});
