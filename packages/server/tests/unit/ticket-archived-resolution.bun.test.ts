/**
 * Integration tests — resolving archived tickets by display id (SQLite)
 *
 * Regression for the `ticket unarchive <displayId>` bug: the display-id lookup
 * used to go through getAllTickets(), which filters `archived_at IS NULL`, so an
 * archived ticket could never be resolved by the id shown to the user. The new
 * getTicketByDisplayId() must span archived tickets (like getTicketById), while
 * getAllTickets() must keep hiding them from the Kanban view.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteTicketStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let conn: SqliteConnection;
let store: SqliteTicketStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteTicketStoreAdapter(conn);
});

afterEach(() => {
  conn.close();
});

describe('SqliteTicketStore — getTicketByDisplayId spans archived', () => {
  it('resolves an archived ticket by its display id (the unarchive use case)', async () => {
    const ticket = TicketEntity.create({
      id: 'tk-archived',
      boardId: 'board-1',
      displayId: 0,
      title: 'Archived one',
    });
    await store.createTicket(ticket); // assigns a real display_id
    const did = ticket.displayId;

    ticket.archive();
    await store.saveTicket(ticket);

    // Precondition: the ticket is genuinely hidden from the active list…
    const active = await store.getAllTickets();
    expect(active.find((t) => t.displayId === did)).toBeUndefined();

    // …yet it is still resolvable by the id the user was shown.
    const byDisplayId = await store.getTicketByDisplayId(did);
    expect(byDisplayId, 'archived ticket must resolve by display id').not.toBeNull();
    expect(byDisplayId?.id).toBe('tk-archived');
    expect(byDisplayId?.archivedAt).not.toBeNull();

    // And by UUID (getTicketById already spanned archived — guard against regression).
    expect((await store.getTicketById('tk-archived'))?.id).toBe('tk-archived');
  });

  it('resolves an active ticket by its display id too', async () => {
    const ticket = TicketEntity.create({
      id: 'tk-active',
      boardId: 'board-1',
      displayId: 0,
      title: 'Active one',
    });
    await store.createTicket(ticket);

    const found = await store.getTicketByDisplayId(ticket.displayId);
    expect(found?.id).toBe('tk-active');
  });

  it('returns null for a display id that does not exist', async () => {
    expect(await store.getTicketByDisplayId(99999)).toBeNull();
  });
});
