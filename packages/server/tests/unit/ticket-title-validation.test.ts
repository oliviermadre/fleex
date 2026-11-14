import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { InvalidTicketTitleError } from '../../src/domain/errors.js';
import { ApplyTicketMutationUseCase } from '../../src/application/use-cases/apply-ticket-mutation.js';
import { CreateTicketUseCase } from '../../src/application/use-cases/create-ticket.js';
import { ticketRoutes } from '../../src/infrastructure/http/tickets.routes.js';
import { registerErrorHandler } from '../../src/infrastructure/http/error-handler.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

/**
 * A ticket title is 1..200 characters once trimmed — for every writer (web, API,
 * CLI, MCP, workflows' `ticket.set_title`), since they all go through the entity.
 * Nothing used to stop an empty title, which renders as a blank row everywhere.
 */

const make = (title: string) => TicketEntity.create({ id: 't1', boardId: 'b1', displayId: 1, title });

describe('TicketEntity title', () => {
  it('is stored trimmed', () => {
    expect(make('  Foo  ').title).toBe('Foo');
    const t = make('Foo');
    expect(t.update({ title: '  Bar ' })).toEqual({ title: { from: 'Foo', to: 'Bar' } });
  });

  it.each([['empty', ''], ['blank', '   '], ['201 chars', 'x'.repeat(201)]])('refuses a %s title, on create and on update', (_, title) => {
    expect(() => make(title)).toThrow(InvalidTicketTitleError);
    const t = make('Foo');
    expect(() => t.update({ title })).toThrow('Title must be 1–200 characters');
    expect(t.title).toBe('Foo');
  });

  it('accepts exactly 200 characters', () => {
    expect(make('x'.repeat(200)).title).toHaveLength(200);
  });

  it('an update that does not touch the title never fails on a legacy over-long title', () => {
    // WHY: titles written before the limit are not truncated; changing the status
    // of such a ticket must keep working.
    const legacy = make('Foo');
    legacy.title = 'x'.repeat(300);
    expect(legacy.update({ status: 'done' })).toEqual({ status: { from: 'backlog', to: 'done' } });
  });

  it('a machine-produced title (PR, import) is made to fit instead of failing the import', () => {
    expect(TicketEntity.fitTitle('x'.repeat(250))).toHaveLength(200);
    expect(TicketEntity.fitTitle('x'.repeat(250)).endsWith('…')).toBe(true);
    expect(TicketEntity.fitTitle('   ')).toBe('Untitled');
    expect(TicketEntity.fitTitle(' PR title ')).toBe('PR title');
  });
});

describe('HTTP: an invalid title is a 400 with a readable message', () => {
  let app: FastifyInstance;
  let ticket: TicketEntity;

  beforeEach(async () => {
    ticket = make('Foo');
    const ticketStore = {
      getTicketById: async () => ticket,
      getBoardById: async () => ({ id: 'b1' }),
      getTicketsByStatus: async () => [],
      createTicket: async () => {},
      saveTicket: async () => {},
      saveActivity: async () => {},
    };
    const eventBus = { emit: () => {} };
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(ticketRoutes({
      ticketStore,
      eventBus,
      logger: new FakeLoggerPort(),
      ticketBroadcast: () => {},
      applyTicketMutation: new ApplyTicketMutationUseCase(ticketStore as never, eventBus as never),
      createTicket: new CreateTicketUseCase(ticketStore as never, eventBus as never),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any));
  });
  afterEach(() => app.close());

  const patch = (body: unknown) => app.inject({ method: 'PATCH', url: '/api/tickets/t1', payload: body as object });

  it.each([['blank', '   '], ['201 chars', 'x'.repeat(201)]])('PATCH with a %s title → 400', async (_, title) => {
    const res = await patch({ title });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'INVALID_TICKET_TITLE', message: 'Title must be 1–200 characters' });
    expect(ticket.title).toBe('Foo');
  });

  it('POST with an empty title → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tickets', payload: { boardId: 'b1', title: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH without a title on a ticket whose legacy title is over the limit → 200', async () => {
    ticket.title = 'x'.repeat(300);
    const res = await patch({ priority: 'high' });
    expect(res.statusCode).toBe(200);
  });

  it('PATCH with a valid title renames', async () => {
    const res = await patch({ title: 'Bar' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Bar', changed: ['title'] });
  });
});
