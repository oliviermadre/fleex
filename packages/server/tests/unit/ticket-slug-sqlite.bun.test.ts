/**
 * The ticket slug survives storage: it is written on create and on every save,
 * read back as is, and a row from before slugs were stored (NULL) derives it
 * from its title until a save locks it — the rename included.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteTicketStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const ID = 'e3265423-0182-483e-81cd-62fdb54841e9';

let conn: SqliteConnection;
let store: SqliteTicketStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteTicketStoreAdapter(conn);
  conn.db.exec(`INSERT INTO boards (id, name, emoji, created_at, updated_at) VALUES ('b1', 'B', '', datetime('now'), datetime('now'))`);
});
afterEach(() => conn.close());

const storedSlug = () => (conn.db.prepare('SELECT slug FROM tickets WHERE id = ?').get(ID) as { slug: string | null }).slug;

describe('ticket slug in SQLite', () => {
  it('is stored at creation and survives a rename', async () => {
    await store.createTicket(TicketEntity.create({ id: ID, boardId: 'b1', displayId: 0, title: 'Foo' }));
    expect(storedSlug()).toBe('foo');

    const t = (await store.getTicketById(ID))!;
    t.update({ title: 'Bar' });
    await store.saveTicket(t);

    const back = (await store.getTicketById(ID))!;
    expect(back.title).toBe('Bar');
    expect(back.slug).toBe('foo');
    expect(storedSlug()).toBe('foo');
  });

  it('a legacy row (NULL) derives its slug from its title, and a rename locks the old one', async () => {
    await store.createTicket(TicketEntity.create({ id: ID, boardId: 'b1', displayId: 0, title: 'Foo' }));
    conn.db.prepare('UPDATE tickets SET slug = NULL WHERE id = ?').run(ID);

    const t = (await store.getTicketById(ID))!;
    expect(t.lockedSlug).toBeNull();
    expect(t.slug).toBe('foo');

    t.update({ title: 'Bar' });
    await store.saveTicket(t);
    expect(storedSlug()).toBe('foo');
  });
});
