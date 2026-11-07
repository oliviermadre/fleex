import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ticketRoutes } from '../../src/infrastructure/http/tickets.routes.js';
import { registerErrorHandler } from '../../src/infrastructure/http/error-handler.js';
import { SubmitDeliverableUseCase } from '../../src/application/use-cases/submit-deliverable.js';
import type { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';
import { FakeConfigPort, FakeLoggerPort } from '../helpers/fakes.js';

/**
 * A deliverable could only be created on a ticket. NaS logged a "Contacted
 * Unipile" event in the Agenda, wanted to attach the message he had sent, and
 * had nowhere to write it: no ticket, so no document. `POST /api/deliverables`
 * creates one with no anchor at all, authored by the human.
 */

let app: FastifyInstance;
let saved: TicketDeliverableEntity[];
let activities: unknown[];
let events: Record<string, unknown>[];

beforeEach(async () => {
  saved = [];
  activities = [];
  events = [];
  const ticketStore = {
    saveActivity: async (a: unknown) => { activities.push(a); },
  };
  const deliverableStore = {
    save: async (d: TicketDeliverableEntity) => { saved.push(d); },
  };
  const container = {
    ticketStore,
    deliverableStore,
    // The real use case: the type check against the workspace's types must
    // stay the one the ticket route goes through.
    submitDeliverable: new SubmitDeliverableUseCase(
      deliverableStore as never,
      ticketStore as never,
      new FakeConfigPort(),
      new FakeLoggerPort(),
    ),
    eventBus: { emit: (e: Record<string, unknown>) => { events.push(e); } },
    logger: new FakeLoggerPort(),
    ticketBroadcast: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(ticketRoutes(container));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/deliverables', payload: payload as object });

describe('POST /api/deliverables — a document with no ticket behind it', () => {
  it('creates an unanchored deliverable authored by the user', async () => {
    const res = await post({ title: 'Msg Unipile', type: 'report', content: 'Bonjour…' });

    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto).toMatchObject({
      title: 'Msg Unipile',
      type: 'report',
      content: 'Bonjour…',
      ticketId: null,
      workflowRunId: null,
      stepRunId: null,
      agentName: 'user',
    });
    expect(saved).toHaveLength(1);
    // No ticket, so no ticket timeline to write to.
    expect(activities).toEqual([]);
  });

  it('accepts an empty content — a document can be started now and filled later', async () => {
    const res = await post({ title: 'To fill in', type: 'report', content: '' });
    expect(res.statusCode).toBe(201);
    expect(res.json().content).toBe('');
  });

  it('honours the requested status', async () => {
    const res = await post({ title: 'Draft', type: 'report', content: 'x', status: 'draft' });
    expect(res.json().status).toBe('draft');
  });

  it.each([
    ['missing title', { type: 'report', content: 'x' }],
    ['blank title', { title: '   ', type: 'report', content: 'x' }],
    ['missing type', { title: 'T', content: 'x' }],
    ['missing content', { title: 'T', type: 'report' }],
    ['unknown status', { title: 'T', type: 'report', content: 'x', status: 'published' }],
  ])('rejects a %s with 400 and saves nothing', async (_label, body) => {
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    expect(saved).toEqual([]);
    expect(events).toEqual([]);
  });

  it('rejects a type the workspace does not know, like the ticket route does', async () => {
    const res = await post({ title: 'T', type: 'not-a-type', content: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_DELIVERABLE_TYPE');
    expect(saved).toEqual([]);
  });

  it('ignores an agentName in the body — the web route only ever writes as the user', async () => {
    // Otherwise any caller could publish a document under an agent's name.
    const res = await post({ title: 'T', type: 'report', content: 'x', agentName: 'builder' });
    expect(res.json().agentName).toBe('user');
  });

  it('emits deliverable.created with no ticket so listeners skip ticket-only work', async () => {
    const res = await post({ title: 'Msg Unipile', type: 'report', content: 'x' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'deliverable.created',
      deliverableId: res.json().id,
      ticketId: null,
      agentName: 'user',
      title: 'Msg Unipile',
    });
  });
});
