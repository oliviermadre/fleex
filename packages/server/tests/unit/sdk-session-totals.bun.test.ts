/**
 * Integration (bun:sqlite) — per-run SDK cost.
 *
 * The SDK reports session totals that a resumed session carries over, so the
 * store must keep those raw totals per run (baseline for the next resume) and
 * migration 035 must turn historical session totals into per-run shares.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteAgentEventStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-agent-event-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { backfillPerRunUsage } from '../../src/infrastructure/migrations/migrations/035_execution_sdk_session_totals.js';
import type { MigrationContext } from '../../src/infrastructure/migrations/types.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let conn: SqliteConnection;
let store: SqliteAgentEventStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteAgentEventStoreAdapter(conn);
});

afterEach(() => conn.close());

function insertRow(id: string, session: string | null, startedAt: string, cost: number | null, source: string | null = null) {
  conn.db.prepare(
    `INSERT INTO agent_event_executions
       (execution_id, persona_id, ticket_id, mention_id, event_count, status, started_at, sdk_session_id, cost_usd, input_tokens, source)
     VALUES (?, 'p1', 't1', ?, 0, 'completed', ?, ?, ?, ?, ?)`,
  ).run(id, `m-${id}`, startedAt, session, cost, cost == null ? null : Math.round(cost * 100), source);
}

const costOf = (id: string) =>
  (conn.db.prepare('SELECT cost_usd, input_tokens, sdk_total_cost_usd FROM agent_event_executions WHERE execution_id = ?').get(id) as
    { cost_usd: number | null; input_tokens: number | null; sdk_total_cost_usd: number | null });

describe('SqliteAgentEventStore — SDK session totals', () => {
  it('returns the totals of the latest run of the session that saw spend', async () => {
    await store.startExecution({ executionId: 'e1', personaId: 'p1', ticketId: 't1', mentionId: 'm1' });
    await store.updateSessionId('e1', 'S');
    await store.completeExecution('e1', 'completed', { costUsd: 8.23, sdkTotals: { costUsd: 8.23, inputTokens: 100 } });
    await new Promise((r) => setTimeout(r, 5));
    await store.startExecution({ executionId: 'e2', personaId: 'p1', ticketId: 't1', mentionId: 'm2' });
    await store.updateSessionId('e2', 'S');
    await store.completeExecution('e2', 'completed', { costUsd: 0.155, sdkTotals: { costUsd: 8.385, inputTokens: 120 } });
    await new Promise((r) => setTimeout(r, 5));
    // A crashed run whose result carried zeroed totals must not become the baseline.
    await store.startExecution({ executionId: 'e3', personaId: 'p1', ticketId: 't1', mentionId: 'm3' });
    await store.updateSessionId('e3', 'S');
    await store.completeExecution('e3', 'failed', { sdkTotals: { costUsd: 0 } });

    expect(await store.getSdkSessionTotals('S')).toMatchObject({ costUsd: 8.385, inputTokens: 120 });
    expect(await store.getSdkSessionTotals('other')).toBeNull();
    expect(costOf('e2').cost_usd).toBeCloseTo(0.155, 10);
  });
});

describe('migration 035 — backfill per-run usage', () => {
  function ctx(): MigrationContext {
    return {
      adapter: 'sqlite',
      exec: async (sql) => { conn.db.exec(sql); },
      query: async (sql) => conn.db.prepare(sql).all() as Record<string, unknown>[],
      dialect: (v) => v.sqlite ?? null,
    };
  }

  it('rewrites historical session totals into each run\'s share (ticket #636)', async () => {
    insertRow('a1', 'S', '2026-10-03T01:02:00Z', 8.23);
    insertRow('a2', 'S', '2026-10-03T01:06:00Z', 8.385);
    insertRow('a3', 'S', '2026-10-03T08:42:00Z', 10.613);
    insertRow('b1', 'T', '2026-10-03T08:00:00Z', 1.5); // another session: untouched share
    insertRow('c1', 'S', '2026-10-03T09:00:00Z', 4.0, 'cli'); // CLI rows are per-session already

    await backfillPerRunUsage(ctx());

    expect(costOf('a1').cost_usd).toBeCloseTo(8.23, 10);
    expect(costOf('a2').cost_usd).toBeCloseTo(0.155, 10);
    expect(costOf('a3').cost_usd).toBeCloseTo(2.228, 10);
    expect(costOf('a3').input_tokens).toBe(1061 - 839);
    expect(costOf('b1').cost_usd).toBe(1.5);
    expect(costOf('c1')).toMatchObject({ cost_usd: 4.0, sdk_total_cost_usd: null });

    // The last run of the session keeps its raw total: the next resume's baseline.
    expect(await store.getSdkSessionTotals('S')).toMatchObject({ costUsd: 10.613 });
    const total = (conn.db.prepare(`SELECT SUM(cost_usd) s FROM agent_event_executions WHERE sdk_session_id = 'S' AND source IS NULL`).get() as { s: number }).s;
    expect(total).toBeCloseTo(10.613, 10);
  });
});
