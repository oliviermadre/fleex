/**
 * Real-database checks for the thread/run termination work. Unlike the fake-store unit
 * tests, these run the REAL registered migrations on in-memory SQLite, so they fail if a
 * migration is not registered (columns missing) or an adapter writes a column that doesn't exist.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteThreadStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-thread-store.adapter.js';
import { SqliteAgentEventStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-agent-event-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import Fastify from 'fastify';
import { assistantThreadsRoutes } from '../../src/infrastructure/http/assistant-threads.routes.js';
import { agentExecutionRoutes } from '../../src/infrastructure/http/agent-execution.routes.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let conn: SqliteConnection;
let threads: SqliteThreadStoreAdapter;
let events: SqliteAgentEventStoreAdapter;

const cols = (table: string) =>
  (conn.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  threads = new SqliteThreadStoreAdapter(conn);
  events = new SqliteAgentEventStoreAdapter(conn);
  conn.db.prepare(`INSERT INTO boards (id,name,emoji,created_at,updated_at) VALUES ('b1','B','x','2026-01-01','2026-01-01')`).run();
  conn.db.prepare(`INSERT INTO tickets (id,board_id,title,description,status,priority,position,tags,links,status_changed_at,created_at,updated_at)
    VALUES ('t1','b1','T','', 'doing','none',0,'[]','[]','2026-01-01','2026-01-01','2026-01-01')`).run();
});
afterEach(() => conn.close());

/** thread → comment (thread_id) → mention → execution, as the conclude route walks it. */
function seedRun(threadId: string, n: string, status: string): string {
  conn.db.prepare(`INSERT INTO comments (id,ticket_id,author_type,author_name,body,visibility,private_recipients,mentions,created_at,updated_at,thread_id)
    VALUES ('c${n}','t1','assistant','jarvis','hi','public','[]','[]','2026-01-01','2026-01-01',?)`).run(threadId);
  conn.db.prepare(`INSERT INTO mentions (id,ticket_id,comment_id,target_agent,source_agent,status,created_at)
    VALUES ('m${n}','t1','c${n}','builder','assistant','pending','2026-01-01')`).run();
  conn.db.prepare(`INSERT INTO agent_event_executions (execution_id,persona_id,ticket_id,mention_id,status,started_at)
    VALUES ('e${n}','builder','t1','m${n}',?,'2026-01-01')`).run(status);
  return `e${n}`;
}

describe('registered migrations (real list)', () => {
  it('create the termination flags and the thread label columns', () => {
    expect(cols('agent_event_executions')).toEqual(expect.arrayContaining(['auto_terminated_at_conclusion', 'manually_terminated_by_user']));
    expect(cols('agent_threads')).toEqual(expect.arrayContaining(['generated_title', 'participants']));
  });
});

describe('thread label persistence', () => {
  it('round-trips generatedTitle and participants, and reads legacy NULL participants as []', async () => {
    const t = AgentThreadEntity.create({ id: 'th1', ticketId: 't1', personaId: 'p', personaName: 'builder', assistantPersonaId: 'pa', brief: 'b', forwardedContext: [] });
    t.generatedTitle = 'Fix the thread panel';
    t.participants = [{ userId: 'u1', displayName: 'Olivier' }, { userId: 'builder', displayName: 'builder' }];
    await threads.save(t);
    const back = await threads.getById('th1');
    expect(back?.generatedTitle).toBe('Fix the thread panel');
    expect(back?.participants).toEqual(t.participants);

    conn.db.prepare(`UPDATE agent_threads SET participants = NULL, generated_title = NULL WHERE id='th1'`).run();
    const legacy = await threads.getById('th1');
    expect(legacy?.participants).toEqual([]);
    expect(legacy?.generatedTitle).toBeNull();
  });
});

describe('getRunsByThreadAndStatus + updateExecutionsByIds on the real schema', () => {
  it('finds only the active runs of the thread and flags them when terminated at conclusion', async () => {
    const run1 = seedRun('th1', '1', 'running');
    seedRun('th1', '2', 'completed');
    seedRun('other', '3', 'running');

    const active = await threads.getRunsByThreadAndStatus('th1', ['running']);
    expect(active.map((r) => r.id)).toEqual([run1]);

    await events.updateExecutionsByIds([run1], 'completed', { autoTerminatedAtConclusion: true });
    const after = await events.getExecutionByMentionId('m1');
    expect(after?.status).toBe('completed');
    expect(after?.autoTerminatedAtConclusion).toBe(true);
    expect(after?.manuallyTerminatedByUser).toBeFalsy();
    expect(await threads.getRunsByThreadAndStatus('th1', ['running'])).toEqual([]);
    expect((await events.getExecutionByMentionId('m3'))?.status).toBe('running');
  });

  it('marks a user-stopped run so the flag survives a re-read', async () => {
    const run = seedRun('th1', '1', 'running');
    await events.updateExecutionsByIds([run], 'interrupted', { manuallyTerminatedByUser: true });
    const back = await events.getExecutionByMentionId('m1');
    expect(back?.status).toBe('interrupted');
    expect(back?.manuallyTerminatedByUser).toBe(true);
  });
});

type ExecRow = { status: string; a: number | null; m: number | null };
const execRow = (id: string) =>
  conn.db.prepare('SELECT status, auto_terminated_at_conclusion a, manually_terminated_by_user m FROM agent_event_executions WHERE execution_id = ?').get(id) as ExecRow;

/** executeAgent fake that records what the DB looked like at the moment the process is killed. */
function fakeExecuteAgent() {
  const cancelled: Array<{ id: string; row: ExecRow }> = [];
  return { cancelled, cancelExecution: async (id: string) => { cancelled.push({ id, row: execRow(id) }); return true; } };
}

describe('POST /api/threads/:id/conclude on a real database', () => {
  it('terminates the running runs of the thread only, flags them, and kills their processes after flagging', async () => {
    const t = AgentThreadEntity.create({ id: 'th1', ticketId: 't1', personaId: 'p', personaName: 'builder', assistantPersonaId: 'pa', brief: 'b', forwardedContext: [] });
    await threads.save(t);
    const r1 = seedRun('th1', '1', 'running');
    const r2 = seedRun('th1', '2', 'running');
    const done = seedRun('th1', '3', 'completed');
    const elsewhere = seedRun('other', '4', 'running');
    const executeAgent = fakeExecuteAgent();
    const turns: unknown[] = [];

    const app = Fastify();
    await app.register(assistantThreadsRoutes({
      threadStore: threads, agentEventStore: events, executeAgent,
      runAssistantTurn: { execute: async (p: unknown) => { turns.push(p); } },
    } as never));
    const res = await app.inject({ method: 'POST', url: '/api/threads/th1/conclude' });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true, runsAutoTerminated: 2 });
    expect(execRow(r1)).toMatchObject({ status: 'completed', a: 1 });
    expect(execRow(r2)).toMatchObject({ status: 'completed', a: 1 });
    expect(execRow(done)).toMatchObject({ status: 'completed', a: 0 });
    expect(execRow(elsewhere)).toMatchObject({ status: 'running', a: 0 });
    // Flag before kill: killing fails the mention and wakes the assistant, which must already see the flag.
    expect(executeAgent.cancelled.map((c) => c.id).sort()).toEqual([r1, r2]);
    for (const c of executeAgent.cancelled) expect(c.row.a).toBe(1);
    expect(turns).toEqual([{ ticketId: 't1', trigger: { kind: 'conclude_request', threadId: 'th1' } }]);
  });
});

describe('POST /api/executions/:id/terminate-manual on a real database', () => {
  it('flags the run as stopped by the user before killing it, and the flag is what the assistant reads back', async () => {
    const run = seedRun('th1', '1', 'running');
    const sibling = seedRun('th1', '2', 'running');
    const executeAgent = fakeExecuteAgent();
    const app = Fastify();
    await app.register(agentExecutionRoutes({ agentEventStore: events, executeAgent } as never));

    const res = await app.inject({ method: 'POST', url: `/api/executions/${run}/terminate-manual`, payload: { reason: 'user_requested' } });

    expect(res.statusCode).toBe(200);
    expect(execRow(run)).toMatchObject({ status: 'interrupted', m: 1 });
    expect(execRow(sibling)).toMatchObject({ status: 'running', m: 0 });
    expect(executeAgent.cancelled).toHaveLength(1);
    expect(executeAgent.cancelled[0]!.row.m).toBe(1); // already flagged when the process was killed
    // run-assistant-turn's skip-logic reads exactly this to decide not to relaunch (covered in run-assistant-turn.test.ts)
    expect((await events.getExecutionByMentionId('m1'))?.manuallyTerminatedByUser).toBe(true);
  });
});
