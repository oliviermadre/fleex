/**
 * Integration (bun:sqlite) — per-run SDK cost bookkeeping.
 *
 * The store keeps, per execution, the raw usage the SDK reported, the CLI that
 * produced it and how `cost_usd` must be read. The baseline of a resumed run is
 * the IMMEDIATELY previous run that spent something — never an older one.
 * Migration 035 only adds columns: history is not rewritten blindly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteAgentEventStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-agent-event-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import migration035 from '../../src/infrastructure/migrations/migrations/035_execution_sdk_session_totals.js';
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

const tick = () => new Promise((r) => setTimeout(r, 5));

async function run(id: string, session: string, metrics: Parameters<SqliteAgentEventStoreAdapter['completeExecution']>[2], status: 'completed' | 'failed' = 'completed') {
  await store.startExecution({ executionId: id, personaId: 'p1', ticketId: 't1', mentionId: `m-${id}` });
  await store.updateSessionId(id, session);
  await store.completeExecution(id, status, metrics);
  await tick();
}

describe('SqliteAgentEventStore — SDK session baseline', () => {
  it('returns the latest earlier run that saw spend, with its CLI version', async () => {
    await run('e1', 'S', { costUsd: 8.23, sdkTotals: { costUsd: 8.23 }, cliVersion: '2.1.284', costBasis: 'per_run' });
    await run('e2', 'S', { costUsd: 0.155, sdkTotals: { costUsd: 8.385 }, cliVersion: '2.1.284', costBasis: 'per_run' });
    // A crashed run with zeroed totals and no cost is skipped, not used as baseline.
    await run('e3', 'S', { sdkTotals: { costUsd: 0 } }, 'failed');
    await store.startExecution({ executionId: 'e4', personaId: 'p1', ticketId: 't1', mentionId: 'm4' });
    await store.updateSessionId('e4', 'S');

    const b = await store.getSdkSessionBaseline('S', 'e4');
    expect(b.priorRuns).toBe(3);
    expect(b.latest).toMatchObject({ totals: { costUsd: 8.385 }, cliVersion: '2.1.284' });
    expect(await store.getSdkSessionBaseline('other', 'e4')).toEqual({ priorRuns: 0, latest: null });
  });

  it('never reaches past a legacy run that spent without recording raw totals', async () => {
    await run('e1', 'S', { costUsd: 8.23, sdkTotals: { costUsd: 8.23 }, cliVersion: '2.1.284' });
    await run('e2', 'S', { costUsd: 10.6 }); // pre-deploy row: cost, no sdk_total
    const b = await store.getSdkSessionBaseline('S', 'e3');
    expect(b).toEqual({ priorRuns: 2, latest: null });
  });

  it('persists cli_version and cost_basis', async () => {
    await run('e1', 'S', { costUsd: 1, sdkTotals: { costUsd: 1 }, cliVersion: '2.1.284', costBasis: 'unverified' });
    const row = conn.db.prepare('SELECT cli_version, cost_basis, sdk_total_cost_usd FROM agent_event_executions WHERE execution_id = ?').get('e1');
    expect(row).toEqual({ cli_version: '2.1.284', cost_basis: 'unverified', sdk_total_cost_usd: 1 });
  });
});

describe('migration 035', () => {
  const ctx = (): MigrationContext => ({
    adapter: 'sqlite',
    exec: async (sql) => { conn.db.exec(sql); },
    query: async (sql) => conn.db.prepare(sql).all() as Record<string, unknown>[],
    dialect: (v) => v.sqlite ?? null,
  });

  it('is idempotent and leaves existing costs untouched (no blind rewrite)', async () => {
    conn.db.prepare(
      `INSERT INTO agent_event_executions (execution_id, persona_id, ticket_id, mention_id, event_count, status, started_at, sdk_session_id, cost_usd)
       VALUES ('legacy', 'p1', 't1', 'm', 0, 'completed', '2026-09-30T00:00:00Z', 'S', 12.156)`,
    ).run();
    await migration035.up(ctx()); // re-run after it already ran in beforeEach
    const row = conn.db.prepare(`SELECT cost_usd, sdk_total_cost_usd, cost_basis FROM agent_event_executions WHERE execution_id = 'legacy'`).get();
    expect(row).toEqual({ cost_usd: 12.156, sdk_total_cost_usd: null, cost_basis: null });
  });
});
