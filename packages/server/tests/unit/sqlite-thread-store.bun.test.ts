import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteThreadStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-thread-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let conn: SqliteConnection;
let store: SqliteThreadStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteThreadStoreAdapter(conn);
});
afterEach(() => conn.close());

function make(id: string, ticketId = 't1') {
  return AgentThreadEntity.create({
    id, ticketId, personaId: 'p1', personaName: 'builder', assistantPersonaId: 'pa',
    brief: `brief ${id}`, forwardedContext: ['ticket'],
  });
}

describe('SqliteThreadStoreAdapter', () => {
  it('round-trips a thread through save/getById', async () => {
    const t = make('th1');
    t.openTurn('m1');
    await store.save(t);
    const back = await store.getById('th1');
    expect(back?.toDTO()).toEqual(t.toDTO());
  });

  it('getByTicket returns newest first and getByCurrentMentionId finds the driver', async () => {
    const a = make('a'); await store.save(a);
    await new Promise((r) => setTimeout(r, 5));
    const b = make('b'); b.openTurn('m-b'); await store.save(b);
    expect((await store.getByTicket('t1')).map((x) => x.id)).toEqual(['b', 'a']);
    expect((await store.getByCurrentMentionId('m-b'))?.id).toBe('b');
    expect(await store.getByCurrentMentionId('nope')).toBeNull();
  });

  it('getOpen excludes terminal threads and save upserts', async () => {
    const a = make('a'); await store.save(a);
    const b = make('b', 't2'); b.conclude('done'); await store.save(b);
    const c = make('c', 't3'); c.markWaiting(); await store.save(c);
    expect((await store.getOpen()).map((x) => x.id).sort()).toEqual(['a', 'c']);
    a.fail(); await store.save(a);
    expect((await store.getOpen()).map((x) => x.id)).toEqual(['c']);
  });
});
