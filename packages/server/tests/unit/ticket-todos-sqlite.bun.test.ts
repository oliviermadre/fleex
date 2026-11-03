/**
 * Integration — the ticket todo list through a real SQLite database (migration
 * 042 + adapter + use-case). Runs under Bun only (`bun run test:bun`).
 *
 * Why it matters: the todo is a shared, audited list. These tests pin the
 * promises the human relies on when reading it back — refs are stable and
 * never reused, every change leaves exactly one attributed history row, a
 * no-op writes nothing, a delete keeps the trail, and an agent cannot erase
 * what a human wrote.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteTodoStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-todo-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketTodosUseCase, type TodoActor } from '../../src/application/use-cases/ticket-todos.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const NAS: TodoActor = { type: 'user', name: 'nas', source: 'web' };
const BUILDER: TodoActor = { type: 'agent', name: 'Builder', source: 'cli' };
const CATALYST: TodoActor = { type: 'agent', name: 'Catalyst', source: 'mcp' };

let conn: SqliteConnection;
let store: SqliteTodoStoreAdapter;
let todos: TicketTodosUseCase;
let emitted: AnyDomainEvent[];

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  conn.db.exec(`
    INSERT INTO boards (id, name, emoji, created_at, updated_at)
    VALUES ('b-1', 'Board', '', datetime('now'), datetime('now'));
    INSERT INTO tickets (id, board_id, display_id, title, description, status, priority, position, tags, links, status_changed_at, created_at, updated_at)
    VALUES ('t-1', 'b-1', 42, 'Ticket', '', 'todo', 'none', 0, '[]', '[]', datetime('now'), datetime('now'), datetime('now'));
  `);
  store = new SqliteTodoStoreAdapter(conn);
  const ticketStore = {
    getTicketById: async (id: string) => (id === 't-1' ? { id, displayId: 42 } : null),
  } as unknown as TicketStorePort;
  emitted = [];
  todos = new TicketTodosUseCase(store, ticketStore, (e) => emitted.push(e));
});

afterEach(() => conn.close());

const texts = async () => (await todos.list('t-1')).map((i) => `#${i.ref} ${i.text}`);

describe('ticket todo list on SQLite', () => {
  it('numbers items per ticket and never reuses a ref, even after a delete', async () => {
    await todos.create('t-1', { text: 'Migration' }, CATALYST);
    await todos.create('t-1', { text: 'Adapters' }, CATALYST);
    await todos.remove('t-1', '2', CATALYST);
    const { item } = await todos.create('t-1', { text: 'Routes' }, CATALYST);
    // #2 is gone but its history still points at "#2": a new item must not take it.
    expect(item.ref).toBe(3);
    expect(await texts()).toEqual(['#1 Migration', '#3 Routes']);
  });

  it('gives distinct refs to concurrent creates (UNIQUE(ticket_id, ref) + retry)', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, n) => todos.create('t-1', { text: `Item ${n}` }, BUILDER)),
    );
    const refs = results.map((r) => r.item.ref).sort((a, b) => a - b);
    expect(refs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('records who closed an item and when, and a done → open → done round trip', async () => {
    await todos.create('t-1', { text: 'Badge' }, CATALYST);
    const done = await todos.update('t-1', '#1', { state: 'done' }, BUILDER);
    expect(done.item).toMatchObject({ state: 'done', stateChangedByType: 'agent', stateChangedByName: 'Builder' });
    expect(done.item.stateChangedAt).not.toBeNull();

    const reopened = await todos.update('t-1', '1', { state: 'todo' }, NAS); // CLI alias
    expect(reopened.item).toMatchObject({ state: 'open', stateChangedByName: 'nas' });
  });

  it('writes no history for a transition to the current state (honest no-op)', async () => {
    await todos.create('t-1', { text: 'Badge' }, NAS);
    await todos.update('t-1', '1', { state: 'done' }, BUILDER);
    const again = await todos.update('t-1', '1', { state: 'done' }, BUILDER);
    expect(again.history).toEqual([]);
    expect((await todos.history('t-1', '1')).map((e) => e.action)).toEqual(['state_changed', 'created']);
  });

  it('writes exactly one attributed history row per kind of change', async () => {
    await todos.create('t-1', { text: 'A' }, CATALYST);
    await todos.create('t-1', { text: 'B' }, CATALYST);
    await todos.update('t-1', '1', { text: 'A bis', note: 'details' }, NAS);
    await todos.update('t-1', '1', { state: 'cancelled', reason: 'covered by #2' }, BUILDER);
    await todos.update('t-1', '2', { after: null }, NAS);
    await todos.remove('t-1', '1', NAS);

    const history = await todos.history('t-1');
    expect(history.map((e) => `${e.action}:#${e.itemRef}:${e.actorName}:${e.source}`)).toEqual([
      'deleted:#1:nas:web',
      'moved:#2:nas:web',
      'state_changed:#1:Builder:cli',
      'edited:#1:nas:web',
      'created:#2:Catalyst:mcp',
      'created:#1:Catalyst:mcp',
    ]);
    const edited = history.find((e) => e.action === 'edited')!;
    expect(edited.changes).toEqual({ text: { from: 'A', to: 'A bis' }, note: { from: null, to: 'details' } });
    const cancelled = history.find((e) => e.action === 'state_changed')!;
    expect(cancelled.changes).toEqual({ state: { from: 'open', to: 'cancelled' }, reason: { from: null, to: 'covered by #2' } });
  });

  it('keeps a deleted item out of the list but its history readable', async () => {
    await todos.create('t-1', { text: 'Gone' }, NAS);
    await todos.remove('t-1', '1', NAS);
    expect(await todos.list('t-1')).toEqual([]);
    expect((await todos.history('t-1', '1')).map((e) => e.action)).toEqual(['deleted', 'created']);
    await expect(todos.update('t-1', '1', { state: 'done' }, NAS)).rejects.toThrow('todo #1 not found on ticket #42');
  });

  it('refuses an agent deleting an item a human created, but lets it cancel it', async () => {
    await todos.create('t-1', { text: 'Human item' }, NAS);
    await expect(todos.remove('t-1', '1', BUILDER)).rejects.toThrow(
      'agents cannot delete an item created by nas — use `todo cancel`',
    );
    const { item } = await todos.update('t-1', '1', { state: 'cancelled', reason: 'duplicate' }, BUILDER);
    expect(item).toMatchObject({ state: 'cancelled', cancelReason: 'duplicate' });
  });

  it('lets an agent delete an item an agent created', async () => {
    await todos.create('t-1', { text: 'Agent item' }, CATALYST);
    await todos.remove('t-1', '1', BUILDER);
    expect(await todos.list('t-1')).toEqual([]);
  });

  it('orders by position: append by default, insert after an item, move first', async () => {
    await todos.create('t-1', { text: 'A' }, NAS);
    await todos.create('t-1', { text: 'C' }, NAS);
    await todos.create('t-1', { text: 'B', after: 1 }, NAS);
    expect(await texts()).toEqual(['#1 A', '#3 B', '#2 C']);
    await todos.update('t-1', '2', { after: null }, NAS);
    expect(await texts()).toEqual(['#2 C', '#1 A', '#3 B']);
    await todos.update('t-1', '2', { after: '3' }, NAS);
    expect(await texts()).toEqual(['#1 A', '#3 B', '#2 C']);
  });

  it('rejects a bad patch as a whole', async () => {
    await todos.create('t-1', { text: 'A' }, NAS);
    await expect(todos.update('t-1', '1', { text: 'B', state: 'finished' }, NAS)).rejects.toThrow('Invalid todo state');
    expect(await texts()).toEqual(['#1 A']);
    await expect(todos.create('t-1', { text: '   ' }, NAS)).rejects.toThrow('Todo text is required');
  });

  it('emits created / updated / deleted with the DTO for the live panel', async () => {
    await todos.create('t-1', { text: 'A' }, NAS);
    await todos.update('t-1', '1', { state: 'done' }, NAS);
    await todos.update('t-1', '1', { state: 'done' }, NAS); // no-op: no event
    await todos.remove('t-1', '1', NAS);
    expect(emitted.map((e) => e.type)).toEqual(['todo.created', 'todo.updated', 'todo.deleted']);
  });

  it('goes away with its ticket (FK cascade)', async () => {
    await todos.create('t-1', { text: 'A' }, NAS);
    conn.db.exec("DELETE FROM tickets WHERE id = 't-1'");
    expect((conn.db.prepare('SELECT COUNT(*) AS n FROM ticket_todo_events').get() as { n: number }).n).toBe(0);
    expect((conn.db.prepare('SELECT COUNT(*) AS n FROM ticket_todo_items').get() as { n: number }).n).toBe(0);
  });
});
