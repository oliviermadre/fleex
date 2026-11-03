/**
 * Integration — which ticket an agent picks up next, through a real SQLite
 * database. Runs under Bun only (`bun run test:bun`).
 *
 * Why it matters: `urgent` exists so that a ticket on fire jumps the queue. If
 * the ranking forgets it (or ranks it as an unknown value), agents would pick a
 * plain `high` ticket first and the new level would be cosmetic only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteTicketStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let conn: SqliteConnection;
let store: SqliteTicketStoreAdapter;

function insertTodo(id: string, priority: string, position: number): void {
  conn.db
    .prepare(
      `INSERT INTO tickets (id, board_id, display_id, title, description, status, priority, position, tags, links, status_changed_at, created_at, updated_at)
       VALUES (?, 'b-1', ?, ?, '', 'todo', ?, ?, '[]', '[]', datetime('now'), datetime('now'), datetime('now'))`,
    )
    .run(id, position + 1, id, priority, position);
}

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  conn.db.exec(`
    INSERT INTO boards (id, name, emoji, created_at, updated_at)
    VALUES ('b-1', 'Board', '', datetime('now'), datetime('now'));
  `);
  store = new SqliteTicketStoreAdapter(conn);
});

afterEach(() => conn.close());

describe('getNextTicketForAgent on SQLite', () => {
  it('hands out an urgent ticket before a high one, even when the high one sits higher on the board', async () => {
    insertTodo('t-high', 'high', 0);
    insertTodo('t-urgent', 'urgent', 5);
    insertTodo('t-none', 'none', 1);

    expect((await store.getNextTicketForAgent('b-1'))?.id).toBe('t-urgent');
  });

  it('stores and reads back the urgent level as-is (no migration needed)', async () => {
    insertTodo('t-urgent', 'urgent', 0);
    expect((await store.getTicketById('t-urgent'))?.priority).toBe('urgent');
  });

  it('ranks an unknown stored value last, with "none"', async () => {
    insertTodo('t-weird', 'critical', 0);
    insertTodo('t-low', 'low', 1);
    expect((await store.getNextTicketForAgent('b-1'))?.id).toBe('t-low');
  });
});
