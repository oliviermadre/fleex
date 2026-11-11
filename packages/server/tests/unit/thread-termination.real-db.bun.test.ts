/**
 * Real-DB integration tests (bun:sqlite, REAL registered migrations — no hand-made schema).
 *
 * History: migrations 048/049 (run termination flags, thread title/participants) were written but never added to `migrations/index.ts`, so the
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
import { StopRunUseCase } from '../../src/application/use-cases/stop-run.js';
import { fakeRunRegistry } from '../helpers/fake-run-registry.js';

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
  /** The real routes and the real stop path on the real stores; only the SDK processes are faked. */
  function setup(assistantTurns: unknown[] = []) {
    const eventBus = new EventBus();
    const registry = fakeRunRegistry(agentEvents, mentions);
    const stopRun = new StopRunUseCase({
      executeAgent: registry as never, agentEventStore: agentEvents, threadStore: threads, mentionStore: mentions,
      eventBus, logger: logger as never,
    });
    const server = Fastify();
    const deps = {
      threadStore: threads, commentStore: comments, mentionStore: mentions, ticketStore: tickets, agentEventStore: agentEvents,
      stopRun, eventBus, config: { get: () => ({}) },
      runAssistantTurn: { execute: async (p: unknown) => { assistantTurns.push(p); } },
      generateThreadTitle: { trigger() {} },
    };
    server.register(assistantThreadsRoutes(deps as never));
    server.register(agentExecutionRoutes(deps as never));
    return { server, registry, stopRun, eventBus };
  }

  it('POST /conclude stops the running run as the user: author persisted, process cancelled, no failure', async () => {
    const { thread, mention, executionId } = await seedRunningThread();
    const turns: unknown[] = [];
    const { server, registry } = setup(turns);
    registry.running.set(executionId, mention.id);
    const res = await server.inject({ method: 'POST', url: `/api/threads/${thread.id}/conclude` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ runsAutoTerminated: 1 });
    expect(registry.cancelled).toEqual([executionId]);
    const exec = (await agentEvents.getExecutionByMentionId(thread.currentMentionId!))!;
    expect(exec.status).toBe('interrupted');
    expect(exec.stoppedBy).toBe('user');
    expect((await mentions.getById(mention.id))!.status).toBe('resolved');
    expect(await threads.getRunsByThreadAndStatus(thread.id, ['running', 'idle', 'waiting'])).toEqual([]);
    expect(turns).toEqual([{ ticketId: 't1', trigger: { kind: 'conclude_request', threadId: thread.id } }]);
  });

  /** A real assistant turn on the real stores, whose model always asks to relaunch the thread. */
  function assistantThatRelaunches(threadId: string, stopRun: StopRunUseCase, woken: string[]) {
    const personas = [AgentPersonaEntity.create({ id: 'p-nas', name: 'nas', displayName: 'Nas', model: 'claude-haiku-4-5-20251001' }),
      AgentPersonaEntity.create({ id: 'p-builder', name: 'builder', displayName: 'The Builder', model: 'claude-haiku-4-5-20251001' })];
    let round = 0;
    return new RunAssistantTurnUseCase({
      threadStore: threads, commentStore: comments, mentionStore: mentions, ticketStore: tickets,
      personaStore: { getById: async (id: string) => personas.find((p) => p.id === id) ?? null, getByName: async (n: string) => personas.find((p) => p.name === n) ?? null, getAll: async () => personas } as never,
      postComment: new PostCommentUseCase(comments, mentions, { saveActivity: async () => {} } as never, logger as never),
      getTicketContext: { execute: async () => ({ ticket: (await tickets.getTicketById('t1'))!.toDTO(), comments: (await comments.getByTicket('t1')).map((c) => c.toDTO()), mentions: { pending: [], all: [] }, deliverables: [], activity: [], relevantSummaries: [], epics: [] }) } as never,
      agentEventStore: agentEvents, executeAgent: { wakeUp: async (m: TicketMentionEntity) => { woken.push(m.id); } } as never, stopRun,
      config: { get: () => ({ basePath: '', defaultShell: '', repositoryRefreshIntervalMs: 0, workThreadsEnabled: true }) } as never,
      eventBus: new EventBus(), logger: logger as never,
      skillStore: { getEnabled: async () => [], getByCommandName: async () => null } as never,
      panelStore: { getEnabled: async () => [], getByName: async () => null } as never,
      workflowTemplateStore: { getEnabled: async () => [], getBySlug: async () => null } as never,
      workflowRunStore: { getByTicket: async () => [], getActiveByTicket: async () => null } as never,
      environment: { workspace: 'qa', cliBin: '/x', hasApiKey: true, cliTools: async () => [], runCli: async () => ({ ok: true, text: '' }) },
    } as never, (async (_p: unknown, _t: unknown) => {
      round++;
      return round % 2 === 1
        ? { content: [{ type: 'tool_use', id: `tu${round}`, name: 'continue_thread', input: { threadId, turn: 'reprends' } }], stopReason: 'tool_use' }
        : { content: [{ type: 'text', text: 'ok', citations: null }], stopReason: 'end_turn' };
    }) as never);
  }
  const builderMentions = async () => (await mentions.getByTicket('t1')).filter((m) => m.targetAgent === 'builder');

  it('POST /terminate-manual: stopped by the user, thread held on disk; the assistant cannot relaunch on a wake-up, and can after a later user message', async () => {
    const { thread, mention, executionId } = await seedRunningThread();
    const { server, registry, stopRun } = setup();
    registry.running.set(executionId, mention.id);
    const res = await server.inject({ method: 'POST', url: `/api/executions/${executionId}/terminate-manual`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(registry.cancelled).toEqual([executionId]);
    const exec = (await agentEvents.getExecutionByMentionId(mention.id))!;
    expect(exec.status).toBe('interrupted');
    expect(exec.stoppedBy).toBe('user');

    // Read back from the database: idle, held, not a failure.
    const held = (await threads.getById(thread.id))!;
    expect(held.status).toBe('idle');
    expect(held.failures).toBe(0);
    expect(held.userHoldAt).toBeInstanceOf(Date);
    expect(held.lastStop).toMatchObject({ by: 'user', mentionId: mention.id });
    expect((await mentions.getById(mention.id))!.status).toBe('resolved');

    const woken: string[] = [];
    const uc = assistantThatRelaunches(thread.id, stopRun, woken);
    // A wake-up from anywhere: the relaunch is refused, the hold stands.
    await uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'resolved' } });
    expect(woken).toEqual([]);
    expect(await builderMentions()).toHaveLength(1);
    expect((await threads.getById(thread.id))!.userHoldAt).toBeInstanceOf(Date);

    // The human asks the assistant to resume, after the stop: accepted, hold lifted.
    await new Promise((r) => setTimeout(r, 5));
    await comments.save(TicketCommentEntity.create({ id: 'c-resume', ticketId: 't1', authorType: 'user', authorName: 'Olivier', body: 'reprends' }));
    await uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c-resume' } });
    expect(await builderMentions()).toHaveLength(2);
    const relaunched = (await threads.getById(thread.id))!;
    expect(relaunched.status).toBe('running');
    expect(relaunched.userHoldAt).toBeNull();
    expect(relaunched.lastStop).toBeNull();
  });
});

describe('migration 050 — author of a stop, on the real schema', () => {
  const cols = (t: string) => (conn.db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

  it('adds the columns, and running it twice is harmless', async () => {
    expect(cols('agent_event_executions')).toEqual(expect.arrayContaining(['stopped_by', 'stop_reason']));
    expect(cols('workflow_runs')).toEqual(expect.arrayContaining(['cancelled_by']));
    expect(cols('agent_threads')).toEqual(expect.arrayContaining(['user_hold_at', 'last_stop', 'concluded_by']));
    const { default: migration } = await import('../../src/infrastructure/migrations/migrations/050_add_stop_author_and_user_hold.js');
    await migration.up({ adapter: 'sqlite', exec: async (sql: string) => { conn.db.exec(sql); } } as never);
  });

  it('a stop keeps its author and reason; the 048 booleans still read as user / system', async () => {
    const { mention, executionId } = await seedRunningThread();
    await agentEvents.markExecutionsStopped([executionId], 'assistant', 'consigne changée');
    expect(await agentEvents.getExecutionByMentionId(mention.id)).toMatchObject({ stoppedBy: 'assistant', stopReason: 'consigne changée', status: 'running' });

    // Rows written before the column existed.
    conn.db.prepare(`UPDATE agent_event_executions SET stopped_by = NULL, manually_terminated_by_user = 1 WHERE execution_id = ?`).run(executionId);
    expect((await agentEvents.getExecutionByMentionId(mention.id))!.stoppedBy).toBe('user');
    conn.db.prepare(`UPDATE agent_event_executions SET manually_terminated_by_user = 0, auto_terminated_at_conclusion = 1 WHERE execution_id = ?`).run(executionId);
    expect((await agentEvents.getExecutionByMentionId(mention.id))!.stoppedBy).toBe('system');
    conn.db.prepare(`UPDATE agent_event_executions SET auto_terminated_at_conclusion = 0 WHERE execution_id = ?`).run(executionId);
    expect((await agentEvents.getExecutionByMentionId(mention.id))!.stoppedBy).toBeNull();
  });

  it('a server restart stops the orphaned runs as system', async () => {
    const { mention } = await seedRunningThread();
    expect(await agentEvents.markInterruptedExecutions()).toEqual([mention.id]);
    expect(await agentEvents.getExecutionByMentionId(mention.id)).toMatchObject({ status: 'interrupted', stoppedBy: 'system', stopReason: 'server_restart' });
  });

  it('a thread keeps its hold, its last stop and who concluded it', async () => {
    const { thread } = await seedRunningThread();
    thread.recordStop('user', 'mauvaise piste');
    await threads.save(thread);
    const back = (await threads.getById(thread.id))!;
    expect(back.status).toBe('idle');
    expect(back.userHoldAt?.toISOString()).toBe(thread.userHoldAt!.toISOString());
    expect(back.lastStop).toEqual(thread.lastStop);
    back.conclude('fini', 'user');
    await threads.save(back);
    expect((await threads.getById(thread.id))!.concludedBy).toBe('user');
    // A thread from before the migration reads as never stopped.
    conn.db.prepare(`UPDATE agent_threads SET user_hold_at = NULL, last_stop = NULL, concluded_by = NULL WHERE id = ?`).run(thread.id);
    expect(await threads.getById(thread.id)).toMatchObject({ userHoldAt: null, lastStop: null, concludedBy: null });
  });
});

describe('migration 051 — turn cap of a thread, on the real schema', () => {
  const cols = () => (conn.db.prepare('PRAGMA table_info(agent_threads)').all() as Array<{ name: string }>).map((c) => c.name);

  it('adds the column, and running it twice is harmless', async () => {
    expect(cols()).toContain('turn_cap');
    const { default: migration } = await import('../../src/infrastructure/migrations/migrations/051_add_thread_turn_cap.js');
    await migration.up({ adapter: 'sqlite', exec: async (sql: string) => { conn.db.exec(sql); } } as never);
    expect(cols().filter((c) => c === 'turn_cap')).toHaveLength(1);
  });

  it('a thread keeps the pending question, then where the count restarts', async () => {
    const { thread } = await seedRunningThread();
    expect((await threads.getById(thread.id))!.turnCap).toBeNull();

    expect(thread.askTurnCap()).toBe(true);
    await threads.save(thread);
    const asked = (await threads.getById(thread.id))!;
    expect(asked.status).toBe('waiting');
    expect(asked.turnCapAskedAt?.toISOString()).toBe(thread.turnCap!.askedAt);
    expect(asked.turnCapBase).toBe(0);
    // Asked once: a second ask changes nothing.
    expect(asked.askTurnCap()).toBe(false);

    asked.resetTurnCap(20);
    await threads.save(asked);
    const back = (await threads.getById(thread.id))!;
    expect(back.turnCap).toEqual({ base: 20, askedAt: null });
    expect(back.turnCapAskedAt).toBeNull();
    expect(back.toDTO().turnCap).toEqual({ base: 20, askedAt: null });

    // A thread from before the migration, or a corrupt value, reads as never capped.
    conn.db.prepare('UPDATE agent_threads SET turn_cap = NULL WHERE id = ?').run(thread.id);
    expect((await threads.getById(thread.id))!.turnCap).toBeNull();
    conn.db.prepare(`UPDATE agent_threads SET turn_cap = 'not json' WHERE id = ?`).run(thread.id);
    expect((await threads.getById(thread.id))!.turnCap).toBeNull();
  });
});
