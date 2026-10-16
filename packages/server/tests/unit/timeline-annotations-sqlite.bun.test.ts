/**
 * Integration — Timeline annotations through a real SQLite database (migration
 * 040 + adapter). Runs under Bun only (`bun run test:bun`): `bun:sqlite`.
 *
 * What only the database can prove: the migration applies, a ticket deletion
 * takes its annotations with it (AC20), updates are real upserts (an INSERT OR
 * REPLACE would delete the row first), and unlinking a deleted source comment
 * keeps the annotation (AC16).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteAnnotationStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-annotation-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TimelineAnnotationEntity } from '../../src/domain/entities/timeline-annotation.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const CREATED = new Date('2026-10-14T09:00:00.000Z');

let conn: SqliteConnection;
let store: SqliteAnnotationStoreAdapter;

const make = (id: string, at: string, over: { sourceCommentId?: string } = {}) =>
  TimelineAnnotationEntity.create({
    id, ticketId: 't-1', ticketCreatedAt: CREATED, at, title: `Titre ${id}`,
    authorType: 'user', authorName: 'nas', now: new Date('2026-10-16T12:00:00.000Z'), ...over,
  });

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  conn.db.exec(`
    INSERT INTO boards (id, name, emoji, created_at, updated_at)
    VALUES ('b-1', 'Board', '', datetime('now'), datetime('now'));
    INSERT INTO tickets (id, board_id, display_id, title, description, status, priority, position, tags, links, status_changed_at, created_at, updated_at)
    VALUES ('t-1', 'b-1', 1, 'Ticket', '', 'todo', 'none', 0, '[]', '[]', datetime('now'), datetime('now'), datetime('now'));
  `);
  store = new SqliteAnnotationStoreAdapter(conn);
});

afterEach(() => conn.close());

describe('timeline_annotations on SQLite', () => {
  it('round-trips an annotation and lists a ticket\'s annotations by instant', async () => {
    await store.save(make('late', '2026-10-15T12:00:00.000Z'));
    await store.save(make('early', '2026-10-15T08:00:00.000Z', { sourceCommentId: 'c-1' }));
    const list = await store.listByTicket('t-1');
    expect(list.map((a) => a.id)).toEqual(['early', 'late']);
    expect(list[0]!.toDTO()).toMatchObject({ tone: 'info', body: '', sourceCommentId: 'c-1', at: '2026-10-15T08:00:00.000Z' });
    expect((await store.getBySourceComment('c-1'))?.id).toBe('early');
  });

  it('updates in place', async () => {
    const a = make('a', '2026-10-15T08:00:00.000Z');
    await store.save(a);
    a.update({ title: 'Nouveau', tone: 'warning' }, CREATED, new Date('2026-10-16T12:00:00.000Z'));
    await store.save(a);
    expect((await store.getById('a'))?.toDTO()).toMatchObject({ title: 'Nouveau', tone: 'warning' });
    expect(await store.listByTicket('t-1')).toHaveLength(1);
  });

  it('keeps the annotation but drops the link when its source comment goes', async () => {
    await store.save(make('a', '2026-10-15T08:00:00.000Z', { sourceCommentId: 'c-1' }));
    await store.clearSourceComment('c-1');
    expect((await store.getById('a'))?.sourceCommentId).toBeNull();
  });

  it('refuses an unknown tone at the database level too', () => {
    expect(() => conn.db.exec(`
      INSERT INTO timeline_annotations (id, ticket_id, at, title, tone, author_type, author_name, created_at, updated_at)
      VALUES ('x', 't-1', '2026-10-15T08:00:00.000Z', 't', 'pink', 'user', 'nas', 'now', 'now')
    `)).toThrow();
  });

  it('deletes a ticket\'s annotations with the ticket (cascade)', async () => {
    await store.save(make('a', '2026-10-15T08:00:00.000Z'));
    conn.db.exec(`DELETE FROM tickets WHERE id = 't-1'`);
    expect(await store.getById('a')).toBeNull();
  });
});
