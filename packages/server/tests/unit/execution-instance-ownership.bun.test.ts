/**
 * Integration tests — per-instance ownership of agentic executions
 *
 * Historical bug: `markInterruptedExecutions()` ran
 * `UPDATE agent_event_executions SET status='interrupted' WHERE status='running'`
 * with no instance predicate. With shared storage (Supabase/pgsql, or a shared
 * SQLite file) that meant booting instance B marked instance A's *live* runs as
 * interrupted and reset their mentions to pending — killing a run on another
 * machine and potentially re-triggering it locally.
 *
 * Migration 025 adds the ownership columns; these tests exercise the real SQL
 * against bun:sqlite so the predicate can't silently regress.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import { AgentEventEntity } from '../../src/domain/entities/agent-event.entity.js';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteAgentEventStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-agent-event-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const INSTANCE_A = { id: 'host-a:3000', label: 'host-a' };
const INSTANCE_B = { id: 'host-b:3000', label: 'host-b' };

let conn: SqliteConnection;
let store: SqliteAgentEventStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteAgentEventStoreAdapter(conn);
  await store.init();
});

afterEach(() => {
  conn.close();
});

async function start(executionId: string, instance: { id: string; label: string }, mentionId: string) {
  await store.startExecution({
    executionId,
    personaId: 'p-1',
    ticketId: 't-1',
    mentionId,
    instanceId: instance.id,
    instanceLabel: instance.label,
  });
}

describe('migration 025 — ownership columns', () => {
  it('adds instance_id / instance_label to agent_event_executions', () => {
    const cols = conn.db
      .prepare(`SELECT name FROM pragma_table_info('agent_event_executions')`)
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain('instance_id');
    expect(names).toContain('instance_label');
  });

  it('indexes (instance_id, status) — the startup sweep filters on both', () => {
    const idx = conn.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_event_executions'`)
      .all() as { name: string }[];
    expect(idx.map((i) => i.name)).toContain('idx_agent_executions_instance');
  });

  it('persists and reads back the owner', async () => {
    await start('e-1', INSTANCE_A, 'm-1');
    const exec = await store.getExecutionById('e-1');
    expect(exec).toMatchObject({ instanceId: INSTANCE_A.id, instanceLabel: INSTANCE_A.label });
  });

  it('returns null for an unknown execution rather than throwing', async () => {
    expect(await store.getExecutionById('nope')).toBeNull();
  });
});

describe('markInterruptedExecutions — scoped to the calling instance', () => {
  it('reclaims only our own orphans and leaves a sibling\'s run running', async () => {
    await start('mine-1', INSTANCE_A, 'm-mine-1');
    await start('mine-2', INSTANCE_A, 'm-mine-2');
    await start('theirs', INSTANCE_B, 'm-theirs');

    const affected = await store.markInterruptedExecutions(INSTANCE_A.id);

    expect(affected.sort()).toEqual(['m-mine-1', 'm-mine-2']);
    expect((await store.getExecutionById('mine-1'))!.status).toBe('interrupted');
    expect((await store.getExecutionById('mine-2'))!.status).toBe('interrupted');
    // The whole point: B's live run survives A's restart.
    expect((await store.getExecutionById('theirs'))!.status).toBe('running');
    expect((await store.getExecutionById('theirs'))!.completedAt).toBeNull();
  });

  it('reports no affected mentions when this instance has no orphans', async () => {
    await start('theirs', INSTANCE_B, 'm-theirs');
    expect(await store.markInterruptedExecutions(INSTANCE_A.id)).toEqual([]);
    expect((await store.getExecutionById('theirs'))!.status).toBe('running');
  });

  it('leaves already-terminal rows alone', async () => {
    await start('done', INSTANCE_A, 'm-done');
    await store.completeExecution('done', 'completed');

    expect(await store.markInterruptedExecutions(INSTANCE_A.id)).toEqual([]);
    expect((await store.getExecutionById('done'))!.status).toBe('completed');
  });
});

describe('mirrorRemoteEvents — sibling stream, local disk', () => {
  // The adapter writes JSONL under the real ~/.fleex, so use a unique id per run
  // and delete the file afterwards — otherwise a rerun would replay stale events.
  const mirroredId = `test-mirror-${randomUUID()}`;
  const mirroredFile = join(homedir(), FLEEX_DIR, 'projects', 'agent-events', `${mirroredId}.jsonl`);

  afterEach(() => {
    rmSync(mirroredFile, { force: true });
  });

  it('records a relayed event without touching the owner\'s counters', async () => {
    // The row belongs to B; only its event stream is mirrored here, so
    // `event_count` / `last_event_at` must stay as B left them.
    await start(mirroredId, INSTANCE_B, 'm-theirs');

    await store.mirrorRemoteEvents([
      AgentEventEntity.create({ executionId: mirroredId, eventType: 'content_block_delta', data: { text: 'hi' }, sequence: 0 }),
      AgentEventEntity.create({ executionId: mirroredId, eventType: 'message_stop', data: { result: 'done' }, sequence: 1 }),
    ]);

    const replayed = await store.getEventsByExecution(mirroredId);
    expect(replayed.map((e) => e.eventType)).toEqual(['content_block_delta', 'message_stop']);

    const exec = await store.getExecutionById(mirroredId);
    expect(exec!.eventCount).toBe(0);
    expect(exec!.lastEventAt).toBeNull();
  });
});
