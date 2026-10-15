/**
 * Real-DB integration tests (bun:sqlite, REAL registered migrations — no hand-made schema).
 *
 * History: migrations 043/044 were written but never added to `migrations/index.ts`, so the
 * columns they create did not exist on real databases while every unit test (all on fakes)
 * stayed green. These tests would have failed on that.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteTicketStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.js';
import { SqliteCommentStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-comment-store.adapter.js';
import { SqliteMentionStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-mention-store.adapter.js';
import { SqliteAgentEventStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-agent-event-store.adapter.js';
import { SqliteThreadStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-thread-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { EventBus } from '../../src/application/event-bus.js';
import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';
import { RunAssistantTurnUseCase } from '../../src/application/use-cases/run-assistant-turn.js';
import { GenerateThreadTitleUseCase, computeParticipants } from '../../src/application/use-cases/thread-label.js';
import { SdkConcurrencyLimiter } from '../../src/application/services/sdk-concurrency-limiter.js';
import { assistantThreadsRoutes } from '../../src/infrastructure/http/assistant-threads.routes.js';
import { agentExecutionRoutes } from '../../src/infrastructure/http/agent-execution.routes.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };

let conn: SqliteConnection;
let tickets: SqliteTicketStoreAdapter;
let comments: SqliteCommentStoreAdapter;
let mentions: SqliteMentionStoreAdapter;
let agentEvents: SqliteAgentEventStoreAdapter;
let threads: SqliteThreadStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, logger as never);
  tickets = new SqliteTicketStoreAdapter(conn);
  comments = new SqliteCommentStoreAdapter(conn);
  mentions = new SqliteMentionStoreAdapter(conn);
  agentEvents = new SqliteAgentEventStoreAdapter(conn);
  threads = new SqliteThreadStoreAdapter(conn);
  const ticket = TicketEntity.create({ id: 't1', boardId: 'b1', displayId: 1, title: 'Panel thread' });
  ticket.updateExecutionConfig({ assistantPersonaId: 'p-nas' });
  await tickets.saveTicket(ticket);
});

/** A thread whose agent has one running execution, linked through comment → mention → execution. */
async function seedRunningThread(suffix = '1') {
  const thread = AgentThreadEntity.create({
    id: `th-${suffix}`, ticketId: 't1', personaId: 'p-builder', personaName: 'builder',
    assistantPersonaId: 'p-nas', brief: 'Corriger le panel', forwardedContext: [],
  });
  const comment = TicketCommentEntity.create({
    id: `c-${suffix}`, ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: '@agent:builder go', threadId: thread.id,
  });
  await comments.save(comment);
  const mention = TicketMentionEntity.create({
    id: `m-${suffix}`, ticketId: 't1', commentId: comment.id, targetAgent: 'builder', sourceAgent: 'Nas',
  });
  await mentions.save(mention);
  thread.openTurn(mention.id);
  await threads.save(thread);
  await agentEvents.startExecution({ executionId: `e-${suffix}`, personaId: 'p-builder', ticketId: 't1', mentionId: mention.id });
  return { thread, mention, executionId: `e-${suffix}` };
}

describe('registered migrations (real schema)', () => {
  it('create the termination-flag and thread-label columns', () => {
    const cols = (t: string) => (conn.db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols('agent_event_executions')).toEqual(expect.arrayContaining(['auto_terminated_at_conclusion', 'manually_terminated_by_user']));
    expect(cols('agent_threads')).toEqual(expect.arrayContaining(['generated_title', 'participants']));
  });

  it('getRunsByThreadAndStatus and updateExecutionsByIds run against them', async () => {
    const { thread, executionId } = await seedRunningThread();
    const runs = await threads.getRunsByThreadAndStatus(thread.id, ['running']);
    expect(runs.map((r) => r.id)).toEqual([executionId]);
    await agentEvents.updateExecutionsByIds([executionId], 'completed', { autoTerminatedAtConclusion: true });
    expect(await threads.getRunsByThreadAndStatus(thread.id, ['running'])).toEqual([]);
  });
});

describe('thread label persistence', () => {
  it('generated title and participants survive a save → read round trip', async () => {
    const { thread } = await seedRunningThread();
    thread.generatedTitle = 'Panel threads lisibles';
    thread.participants = [{ userId: 'user:olivier', displayName: 'Olivier' }];
    await threads.save(thread);
    const back = (await threads.getById(thread.id))!;
    expect(back.generatedTitle).toBe('Panel threads lisibles');
    expect(back.participants).toEqual([{ userId: 'user:olivier', displayName: 'Olivier' }]);
  });

  it('a thread saved without them reads back as null title and no participants', async () => {
    const { thread } = await seedRunningThread();
    const back = (await threads.getById(thread.id))!;
    expect(back.generatedTitle).toBeNull();
    expect(back.participants).toEqual([]);
  });

  it('participants are the distinct authors of the thread comments, users and agents', async () => {
    const { thread } = await seedRunningThread();
    for (const [i, [type, name]] of ([['user', 'Olivier'], ['agent', 'builder'], ['user', 'Olivier']] as const).entries()) {
      await comments.save(TicketCommentEntity.create({ id: `x${i}`, ticketId: 't1', authorType: type, authorName: name, body: 'hi', threadId: thread.id }));
    }
    await comments.save(TicketCommentEntity.create({ id: 'other', ticketId: 't1', authorType: 'user', authorName: 'Stranger', body: 'main stream' }));
    const all = await comments.getByTicket('t1');
    expect(computeParticipants(all, thread.id).map((p) => p.displayName)).toEqual(['Nas', 'Olivier', 'builder']);
  });

  it('title generation writes once, never throws on failure, and leaves null', async () => {
    const { thread } = await seedRunningThread();
    const bus = new EventBus();
    const events: string[] = [];
    bus.on('*', (e) => { events.push(e.type); });
    const limiter = new SdkConcurrencyLimiter(() => 1);
    await new GenerateThreadTitleUseCase(threads, limiter, bus, logger as never, async () => { throw new Error('boom'); }).execute(thread.id, 'salut');
    expect((await threads.getById(thread.id))!.generatedTitle).toBeNull();
    let calls = 0;
    const ok = new GenerateThreadTitleUseCase(threads, limiter, bus, logger as never, async () => { calls++; return '"Un titre."\n'; });
    await ok.execute(thread.id, 'salut');
    await ok.execute(thread.id, 'encore');
    expect((await threads.getById(thread.id))!.generatedTitle).toBe('Un titre');
    expect(calls).toBe(1);
    expect(events).toEqual(['thread.updated']);
  });
});

describe('Conclude and manual termination, on a real database', () => {
  function app(executeAgent: { cancelExecution(id: string): Promise<boolean> }, assistantTurns: unknown[] = []) {
    const server = Fastify();
    const deps = {
      threadStore: threads, commentStore: comments, mentionStore: mentions, ticketStore: tickets, agentEventStore: agentEvents,
      executeAgent, eventBus: new EventBus(), config: { get: () => ({}) },
      runAssistantTurn: { execute: async (p: unknown) => { assistantTurns.push(p); } },
      generateThreadTitle: { trigger() {} },
    };
    server.register(assistantThreadsRoutes(deps as never));
    server.register(agentExecutionRoutes(deps as never));
    return server;
  }

  it('POST /conclude terminates the running run: flagged, completed, process cancelled', async () => {
    const { thread, executionId } = await seedRunningThread();
    const cancelled: string[] = [];
    const res = await app({ cancelExecution: async (id) => { cancelled.push(id); return true; } }).inject({ method: 'POST', url: `/api/threads/${thread.id}/conclude` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ runsAutoTerminated: 1 });
    expect(cancelled).toEqual([executionId]);
    const exec = (await agentEvents.getExecutionByMentionId(thread.currentMentionId!))!;
    expect(exec.status).toBe('completed');
    expect(exec.autoTerminatedAtConclusion).toBe(true);
    expect(await threads.getRunsByThreadAndStatus(thread.id, ['running', 'idle', 'waiting'])).toEqual([]);
  });

  it('POST /terminate-manual sets the flag; the assistant then does not relaunch the agent', async () => {
    const { thread, mention, executionId } = await seedRunningThread();
    // The agent's turn ends (cancelling fails the mention), the thread is failed: the assistant is called back.
    const cancelled: string[] = [];
    const res = await app({ cancelExecution: async (id) => { cancelled.push(id); return true; } })
      .inject({ method: 'POST', url: `/api/executions/${executionId}/terminate-manual`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(cancelled).toEqual([executionId]);
    const exec = (await agentEvents.getExecutionByMentionId(mention.id))!;
    expect(exec.manuallyTerminatedByUser).toBe(true);
    expect(exec.status).toBe('interrupted');

    mention.acknowledge(); mention.markFailed(); await mentions.save(mention);
    const saved = (await threads.getById(thread.id))!; saved.fail(); await threads.save(saved);

    const personas = [AgentPersonaEntity.create({ id: 'p-nas', name: 'nas', displayName: 'Nas', model: 'claude-haiku-4-5-20251001' }),
      AgentPersonaEntity.create({ id: 'p-builder', name: 'builder', displayName: 'The Builder', model: 'claude-haiku-4-5-20251001' })];
    const woken: string[] = [];
    let round = 0;
    const uc = new RunAssistantTurnUseCase({
      threadStore: threads, commentStore: comments, mentionStore: mentions, ticketStore: tickets,
      personaStore: { getById: async (id: string) => personas.find((p) => p.id === id) ?? null, getByName: async (n: string) => personas.find((p) => p.name === n) ?? null, getAll: async () => personas } as never,
      postComment: new PostCommentUseCase(comments, mentions, { saveActivity: async () => {} } as never, logger as never),
      getTicketContext: { execute: async () => ({ ticket: (await tickets.getTicketById('t1'))!.toDTO(), comments: [], mentions: { pending: [], all: [] }, deliverables: [], activity: [], relevantSummaries: [], epics: [] }) } as never,
      agentEventStore: agentEvents, executeAgent: { cancelExecutionForMention: async () => true, wakeUp: async (m: TicketMentionEntity) => { woken.push(m.id); } } as never,
      config: { get: () => ({ basePath: '', defaultShell: '', repositoryRefreshIntervalMs: 0, workThreadsEnabled: true }) } as never,
      eventBus: new EventBus(), logger: logger as never,
      skillStore: { getEnabled: async () => [], getByCommandName: async () => null } as never,
      panelStore: { getEnabled: async () => [], getByName: async () => null } as never,
      workflowTemplateStore: { getEnabled: async () => [], getBySlug: async () => null } as never,
      workflowRunStore: { getByTicket: async () => [], getActiveByTicket: async () => null } as never,
      environment: { workspace: 'qa', cliBin: '/x', hasApiKey: true, cliTools: async () => [], runCli: async () => ({ ok: true, text: '' }) },
    } as never, (async (_p: unknown, _t: unknown) => {
      round++;
      return round === 1
        ? { content: [{ type: 'tool_use', id: 'tu', name: 'continue_thread', input: { threadId: thread.id, turn: 'reprends' } }], stopReason: 'tool_use' }
        : { content: [{ type: 'text', text: 'ok', citations: null }], stopReason: 'end_turn' };
    }) as never);

    await uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'failed' } });
    expect(woken).toEqual([]);
    expect((await mentions.getByTicket('t1')).filter((m) => m.targetAgent === 'builder')).toHaveLength(1);
  });
});
