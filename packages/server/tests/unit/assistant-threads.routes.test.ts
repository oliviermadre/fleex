import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { assistantThreadsRoutes } from '../../src/infrastructure/http/assistant-threads.routes.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { EventBus } from '../../src/application/event-bus.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

function thread(id = 'th') {
  return AgentThreadEntity.create({ id, ticketId: 't1', personaId: 'p', personaName: 'b', assistantPersonaId: 'a', brief: 'x', forwardedContext: [] });
}

describe('assistant threads routes', () => {
  it('POST assistant/messages answers { assistant: null } and posts nothing when no assistant is configured', async () => {
    const app = Fastify();
    const posted: unknown[] = [];
    await app.register(assistantThreadsRoutes({
      ticketStore: { getTicketById: async () => ({ id: 't1', assistantPersonaId: null }) },
      runAssistantTurn: { resolveAssistantPersona: async () => null, execute: async () => {} },
      postComment: { execute: async (p: unknown) => { posted.push(p); return { comment: { id: 'c', toDTO: () => ({}) }, createdMentions: [] }; } },
      config: { get: () => ({}) }, eventBus: new EventBus(), threadStore: {}, commentStore: {}, mentionStore: {},
    } as never));
    const res = await app.inject({ method: 'POST', url: '/api/tickets/t1/assistant/messages', payload: { body: 'hello' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ comment: null, assistant: null });
    expect(posted).toHaveLength(0);
  });

  it('POST assistant/messages posts the user comment with agent mentions suppressed and starts a turn', async () => {
    const app = Fastify();
    const posted: Array<Record<string, unknown>> = [];
    const turns: unknown[] = [];
    await app.register(assistantThreadsRoutes({
      ticketStore: { getTicketById: async () => ({ id: 't1' }) },
      runAssistantTurn: {
        resolveAssistantPersona: async () => ({ id: 'pa', name: 'nas', displayName: 'Nas' }),
        execute: async (p: unknown) => { turns.push(p); },
      },
      postComment: { execute: async (p: Record<string, unknown>) => { posted.push(p); return { comment: { id: 'c1', toDTO: () => ({ id: 'c1' }) }, createdMentions: [] }; } },
      config: { get: () => ({ humanDisplayName: 'Olivier' }) }, eventBus: new EventBus(), threadStore: {}, commentStore: {}, mentionStore: {},
    } as never));
    const res = await app.inject({ method: 'POST', url: '/api/tickets/t1/assistant/messages', payload: { body: '@agent:builder go' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ comment: { id: 'c1' }, assistant: { personaId: 'pa', displayName: 'Nas' } });
    expect(posted[0]).toMatchObject({ authorType: 'user', authorName: 'Olivier', suppressAgentMentions: true, threadId: null });
    expect(turns).toEqual([{ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c1' } }]);
  });

  it('GET /api/threads/open lists open threads', async () => {
    const app = Fastify();
    await app.register(assistantThreadsRoutes({ threadStore: { getOpen: async () => [thread()] } } as never));
    const res = await app.inject({ method: 'GET', url: '/api/threads/open' });
    expect(res.json()).toHaveLength(1);
  });

  it('POST /api/threads/:id/conclude refuses a closed thread', async () => {
    const app = Fastify();
    const t = thread();
    t.conclude('done');
    await app.register(assistantThreadsRoutes({ threadStore: { getById: async () => t } } as never));
    const res = await app.inject({ method: 'POST', url: '/api/threads/th/conclude' });
    expect(res.statusCode).toBe(409);
  });

  it('POST /api/threads/:id/messages prefixes the persona mention when the agent is not waiting', async () => {
    const app = Fastify();
    const t = thread();
    const posted: Array<Record<string, unknown>> = [];
    await app.register(assistantThreadsRoutes({
      threadStore: { getById: async () => t, save: async () => {} },
      mentionStore: { getById: async () => null },
      config: { get: () => ({}) }, eventBus: new EventBus(),
      postComment: { execute: async (p: Record<string, unknown>) => { posted.push(p); return { comment: { id: 'c2', toDTO: () => ({ id: 'c2' }) }, createdMentions: [{ id: 'm9', targetAgent: 'b', targetType: 'agent', sourceAgent: 'user' }] }; } },
    } as never));
    const res = await app.inject({ method: 'POST', url: '/api/threads/th/messages', payload: { body: 'check the fallback' } });
    expect(res.statusCode).toBe(201);
    expect(posted[0]).toMatchObject({ body: '@agent:b check the fallback', threadId: 'th', suppressMentionForAgents: [] });
    expect(t.currentMentionId).toBe('m9');
  });
});

describe('POST /api/tickets/:id/assistant/start', () => {
  it('starts a ticket_created turn when an assistant is configured', async () => {
    const app = Fastify();
    const turns: unknown[] = [];
    await app.register(assistantThreadsRoutes({
      ticketStore: { getTicketById: async () => ({ id: 't1' }) },
      runAssistantTurn: { resolveAssistantPersona: async () => ({ id: 'pa', name: 'nas', displayName: 'Nas' }), execute: async (p: unknown) => { turns.push(p); } },
    } as never));
    const res = await app.inject({ method: 'POST', url: '/api/tickets/t1/assistant/start' });
    expect(res.statusCode).toBe(202);
    expect(turns).toEqual([{ ticketId: 't1', trigger: { kind: 'ticket_created' } }]);
  });
});

describe('GET /api/tickets/:id/threads — read repair', () => {
  it('parks a running thread whose mention is already resolved as idle', async () => {
    const app = Fastify();
    const t = thread();
    t.openTurn('m1');
    const saved: string[] = [];
    const turns: unknown[] = [];
    await app.register(assistantThreadsRoutes({
      threadStore: { getByTicket: async () => [t], save: async (x: { status: string }) => { saved.push(x.status); } },
      mentionStore: { getById: async () => ({ status: 'resolved' }) },
      runAssistantTurn: { execute: async (p: unknown) => { turns.push(p); } },
    } as never));
    const res = await app.inject({ method: 'GET', url: '/api/tickets/t1/threads' });
    expect(res.json()[0].status).toBe('idle');
    expect(saved).toEqual(['idle']);
    expect(turns).toEqual([{ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: 'th', mentionStatus: 'resolved' } }]);
  });

  it('frees a new turn queued behind an older waiting turn of the same thread (stale lane)', async () => {
    // Data from before the busy-agent guard: m-old (waiting_for_info) holds the
    // (agent, ticket) lane, m-new (pending) can never start. The repair closes m-old.
    const app = Fastify();
    const t = thread();
    t.openTurn('m-new');
    const resolved: string[] = [];
    const kicked: string[] = [];
    const emitted: string[] = [];
    const bus = new EventBus();
    bus.on('mention.resolved', (e) => { emitted.push((e as { mentionId: string }).mentionId); });
    const mOld = { id: 'm-old', targetAgent: 'b', status: 'waiting_for_info', commentId: 'c-old', resolve() { this.status = 'resolved'; } };
    const mOther = { id: 'm-other', targetAgent: 'b', status: 'waiting_for_info', commentId: 'c-other', resolve() { this.status = 'resolved'; } };
    const mNew = { id: 'm-new', targetAgent: 'b', status: 'pending', commentId: 'c-new' };
    const ticket = TicketEntity.create({ id: 't1', boardId: 'b', displayId: 74, title: 'latency' });
    ticket.update({ blocked: true });
    let ticketSaves = 0;
    await app.register(assistantThreadsRoutes({
      eventBus: bus,
      ticketStore: { getTicketById: async () => ticket, saveTicket: async () => { ticketSaves++; } },
      threadStore: { getByTicket: async () => [t], save: async () => {} },
      mentionStore: {
        getById: async (id: string) => (id === 'm-new' ? mNew : null),
        getByTicket: async () => [mOld, mOther, mNew],
        save: async (m: { id: string }) => { resolved.push(m.id); },
      },
      // m-other waits in ANOTHER thread: it is not ours to close.
      commentStore: { getById: async (id: string) => ({ threadId: id === 'c-old' ? 'th' : 'th-2' }) },
      executeAgent: { execute: async (personaId: string) => { kicked.push(personaId); } },
      runAssistantTurn: { execute: async () => {} },
    } as never));
    const res = await app.inject({ method: 'GET', url: '/api/tickets/t1/threads' });
    expect(res.json()[0].status).toBe('running');
    expect(resolved).toEqual(['m-old']);
    expect(mOld.status).toBe('resolved');
    expect(mOther.status).toBe('waiting_for_info');
    expect(emitted).toEqual(['m-old']);
    expect(kicked).toEqual(['p']);
    expect(ticket.blocked).toBe(false);
    expect(ticketSaves).toBe(1);
  });
});
