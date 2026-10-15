/**
 * WHY: the memory sweeper polls `embedding IS NULL ORDER BY created_at` once a
 * minute on every instance. Without an index serving it, each poll scanned the
 * whole memory_chunks table (932 ms on Supabase, 155 MB) and starved every
 * other query into statement timeouts. This guards that the query keeps an
 * index — dropping or reshaping migration 039 makes it fail.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let conn: SqliteConnection;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
});

afterEach(() => conn.close());

describe('memory_chunks pending-embedding backlog query', () => {
  it('is served by idx_memory_chunks_pending, not a table scan', () => {
    const plan = conn.db
      .prepare('EXPLAIN QUERY PLAN SELECT id FROM memory_chunks WHERE embedding IS NULL ORDER BY created_at ASC LIMIT 50')
      .all() as { detail: string }[];
    const details = plan.map((p) => p.detail).join(' | ');
    expect(details).toContain('idx_memory_chunks_pending');
    expect(details).not.toMatch(/SCAN memory_chunks(?! USING)/);
  });
});
