import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteCommentStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-comment-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let conn: SqliteConnection;
let store: SqliteCommentStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteCommentStoreAdapter(conn);
});
afterEach(() => conn.close());

const make = (id: string, questions?: { prompt: string; options: string[] }[] | null) =>
  TicketCommentEntity.create({ id, ticketId: 't1', authorType: 'agent', authorName: 'Dev', body: 'Q?', questions });

describe('SqliteCommentStoreAdapter — questions', () => {
  it('round-trips questions', async () => {
    const questions = [{ prompt: 'Front ?', options: ['Ici', 'Séparé'] }];
    await store.save(make('c1', questions));
    expect((await store.getById('c1'))!.questions).toEqual(questions);
    expect((await store.getById('c1'))!.toDTO().questions).toEqual(questions);
  });

  it('reads a comment without questions as null', async () => {
    await store.save(make('c2'));
    expect((await store.getById('c2'))!.questions).toBeNull();
  });

  it('reads a corrupt questions cell as null instead of throwing', async () => {
    await store.save(make('c3'));
    conn.db.prepare(`UPDATE comments SET questions = '{not json' WHERE id = 'c3'`).run();
    expect((await store.getById('c3'))!.questions).toBeNull();
  });
});
