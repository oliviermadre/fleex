/**
 * Ticket naming survives storage: the slug is written on create, read back as
 * is, and survives a rename; the former-naming overrides (`workspace_dir`,
 * `branch_name`) round-trip. A row from before slugs were stored (NULL) keeps
 * its NULL through an unrelated save — the boot backfill must still see it to
 * read its folder from disk — and only a rename locks it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteTicketStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { ticketBranchName, ticketWorkspaceId } from '@fleex/shared';

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

const stored = () => conn.db.prepare('SELECT slug, workspace_dir, branch_name FROM tickets WHERE id = ?').get(ID) as
  { slug: string | null; workspace_dir: string | null; branch_name: string | null };
const create = async (title = 'Foo') => {
  const t = TicketEntity.create({ id: ID, boardId: 'b1', displayId: 0, title });
  await store.createTicket(t);
  return t;
};

describe('ticket naming in SQLite', () => {
  it('the slug is stored at creation and survives a rename; the names use the display id from the insert', async () => {
    const created = await create();
    expect(stored()).toEqual({ slug: 'foo', workspace_dir: null, branch_name: null });

    const t = (await store.getTicketById(ID))!;
    t.update({ title: 'Bar' });
    await store.saveTicket(t);

    const back = (await store.getTicketById(ID))!;
    expect(back.title).toBe('Bar');
    expect(back.slug).toBe('foo');
    expect(ticketWorkspaceId(back)).toBe(`${created.displayId}-foo`);
    expect(ticketBranchName(back)).toBe(`fleex/${created.displayId}-foo`);
  });

  it('the former-naming overrides round-trip', async () => {
    await create();
    const t = (await store.getTicketById(ID))!;
    t.workspaceDir = 'e32654-old';
    t.branchName = 'ticket/e32654-old';
    await store.saveTicket(t);

    const back = (await store.getTicketById(ID))!;
    expect(ticketWorkspaceId(back)).toBe('e32654-old');
    expect(ticketBranchName(back)).toBe('ticket/e32654-old');
    expect(back.toDTO()).toMatchObject({ workspaceDir: 'e32654-old', branchName: 'ticket/e32654-old' });
  });

  it('a legacy row (NULL) keeps its NULL through an unrelated save, so the backfill still sees it', async () => {
    await create();
    conn.db.prepare('UPDATE tickets SET slug = NULL WHERE id = ?').run(ID);

    const t = (await store.getTicketById(ID))!;
    expect(t.lockedSlug).toBeNull();
    expect(t.slug).toBe('foo');
    t.update({ status: 'doing' });
    await store.saveTicket(t);
    expect(stored().slug).toBeNull();
    expect((await store.getTicketsWithoutSlug()).map((x) => x.id)).toEqual([ID]);
  });

  it('a rename locks a legacy row on the slug it was named after', async () => {
    await create();
    conn.db.prepare('UPDATE tickets SET slug = NULL WHERE id = ?').run(ID);
    const t = (await store.getTicketById(ID))!;
    t.update({ title: 'Bar' });
    await store.saveTicket(t);
    expect(stored().slug).toBe('foo');
    expect(await store.getTicketsWithoutSlug()).toEqual([]);
  });

  it('getTicketsWithoutSlug includes archived tickets (their folder is still on disk)', async () => {
    await create();
    conn.db.prepare(`UPDATE tickets SET slug = NULL, archived_at = datetime('now') WHERE id = ?`).run(ID);
    expect((await store.getTicketsWithoutSlug()).map((x) => x.id)).toEqual([ID]);
  });
});
