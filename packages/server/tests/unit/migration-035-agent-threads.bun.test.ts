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

function columns(table: string): string[] {
  return (conn.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe('035_agent_threads', () => {
  it('creates agent_threads with the expected columns', () => {
    expect(columns('agent_threads')).toEqual(expect.arrayContaining([
      'id', 'ticket_id', 'initiator', 'persona_id', 'persona_name', 'assistant_persona_id', 'brief',
      'forwarded_context', 'status', 'current_mention_id', 'exchanges', 'summary',
      'created_at', 'updated_at', 'concluded_at',
    ]));
  });
  it('adds nullable thread_id on comments and assistant_persona_id on tickets', () => {
    expect(columns('comments')).toContain('thread_id');
    expect(columns('tickets')).toContain('assistant_persona_id');
  });
  it('is idempotent on a second run', async () => {
    await expect(runPendingMigrations('sqlite', conn, silent as never)).resolves.toBeUndefined();
    expect(columns('agent_threads')).toContain('id');
  });
});
