/**
 * Runs the REAL migration list on an in-memory SQLite, then exercises the queries
 * the Conclude / terminate-manual flows depend on. Earlier unit tests used fake
 * stores, so migrations 043/044 were never registered and nothing noticed: the
 * columns did not exist and these queries failed with "no such column".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteThreadStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-thread-store.adapter.js';
import { SqliteAgentEventStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-agent-event-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const NOW = '2026-01-01T00:00:00.000Z';

let conn: SqliteConnection;
let threads: SqliteThreadStoreAdapter;
let events: SqliteAgentEventStoreAdapter;

function columns(table: string): string[] {
  return (conn.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

/** A thread with one comment, one mention and one execution in the given status. */
function seedRun(threadId: string, n: number, status: string): string {
  const commentId = `c-${threadId}-${n}`;
  const mentionId = `m-${threadId}-${n}`;
  const executionId = `e-${threadId}-${n}`;
  conn.db.prepare(
    `INSERT INTO comments (id, ticket_id, author_type, author_name, body, visibility, private_recipients, mentions, created_at, updated_at, thread_id)
     VALUES (?, 't1', 'agent', 'a', 'x', 'public', '[]', '[]', ?, ?, ?)`,
  ).run(commentId, NOW, NOW, threadId);
  conn.db.prepare(
    `INSERT INTO mentions (id, ticket_id, comment_id, target_agent, source_agent, status, created_at)
     VALUES (?, 't1', ?, 'builder', 'assistant', 'pending', ?)`,
  ).run(mentionId, commentId, NOW);
  conn.db.prepare(
    `INSERT INTO agent_event_executions (execution_id, persona_id, ticket_id, mention_id, status, started_at)
     VALUES (?, 'builder', 't1', ?, ?, ?)`,
  ).run(executionId, mentionId, status, NOW);
  return executionId;
}

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  threads = new SqliteThreadStoreAdapter(conn);
  events = new SqliteAgentEventStoreAdapter(conn);
  conn.db.prepare(`INSERT INTO boards (id, name, emoji, created_at, updated_at) VALUES ('b1', 'B', 'x', ?, ?)`).run(NOW, NOW);
  conn.db.prepare(
    `INSERT INTO tickets (id, board_id, title, description, status, priority, position, tags, links, status_changed_at, created_at, updated_at)
     VALUES ('t1', 'b1', 'T', '', 'doing', 'none', 0, '[]', '[]', ?, ?, ?)`,
  ).run(NOW, NOW, NOW);
});

describe('real migrations', () => {
  it('create the run-termination and thread label columns', () => {
    expect(columns('agent_event_executions')).toEqual(
      expect.arrayContaining(['auto_terminated_at_conclusion', 'manually_terminated_by_user']),
    );
    expect(columns('agent_threads')).toEqual(expect.arrayContaining(['generated_title', 'participants']));
  });
});

describe('getRunsByThreadAndStatus on a migrated database', () => {
  it('returns only the thread\'s runs in the requested statuses, with the flags', async () => {
    const running = seedRun('th1', 1, 'running');
    seedRun('th1', 2, 'completed');
    seedRun('th2', 1, 'running'); // another thread: must not leak in

    const runs = await threads.getRunsByThreadAndStatus('th1', ['running']);

    expect(runs.map((r) => r.id)).toEqual([running]);
    expect(runs[0]!.manuallyTerminatedByUser).toBeFalsy();
    expect(runs[0]!.autoTerminatedAtConclusion).toBeFalsy();
  });
});

describe('updateExecutionsByIds on a migrated database', () => {
  it('terminates the runs and persists the flags', async () => {
    const a = seedRun('th1', 1, 'running');
    const b = seedRun('th1', 2, 'running');
    const untouched = seedRun('th1', 3, 'running');

    await events.updateExecutionsByIds([a], 'interrupted', { manuallyTerminatedByUser: true });
    await events.updateExecutionsByIds([b], 'completed', { autoTerminatedAtConclusion: true });

    const row = (id: string) =>
      conn.db.prepare('SELECT status, auto_terminated_at_conclusion a, manually_terminated_by_user m FROM agent_event_executions WHERE execution_id = ?').get(id) as
        { status: string; a: number | null; m: number | null };
    expect(row(a)).toMatchObject({ status: 'interrupted', m: 1 });
    expect(row(b)).toMatchObject({ status: 'completed', a: 1 });
    expect(row(untouched).status).toBe('running');
    // an auto-terminated run is no longer "active": Conclude is idempotent
    expect(await threads.getRunsByThreadAndStatus('th1', ['running'])).toHaveLength(1);
  });
});

describe('thread label persistence', () => {
  it('round-trips generatedTitle and participants through save()', async () => {
    const t = AgentThreadEntity.create({
      id: 'th1', ticketId: 't1', personaId: 'builder', personaName: 'builder',
      assistantPersonaId: 'jarvis', brief: 'b', forwardedContext: [],
    });
    t.generatedTitle = 'Fix the panel';
    t.participants = [{ userId: 'u1', displayName: 'Olivier' }];
    await threads.save(t);

    const back = await threads.getById('th1');
    expect(back!.generatedTitle).toBe('Fix the panel');
    expect(back!.participants).toEqual([{ userId: 'u1', displayName: 'Olivier' }]);
  });
});
