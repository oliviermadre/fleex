/**
 * Integration — the Factory store through a real SQLite database (migration
 * 045 + adapter). Runs under Bun only (`bun run test:bun`): `bun:sqlite`.
 *
 * What only the database can prove: the migration applies and its `down()`
 * leaves nothing behind, a ticket deletion takes its Factory rows with it, and
 * saves are real upserts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteFactoryStore } from '../../src/factory/sqlite-factory-store.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import factoryMigration from '../../src/infrastructure/migrations/migrations/045_factory.js';
import itemsMigration from '../../src/infrastructure/migrations/migrations/047_factory_items.js';
import itemRunsMigration from '../../src/infrastructure/migrations/migrations/048_factory_item_runs.js';
import pullsMigration from '../../src/infrastructure/migrations/migrations/050_factory_intake_pulls.js';
import bodiesMigration from '../../src/infrastructure/migrations/migrations/051_factory_item_bodies.js';
import { DEFAULT_SETTINGS, type FactoryItemRow, type FactoryRunRow, type FactoryTicketRow } from '../../src/factory/types.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const NOW = '2026-11-15T10:00:00.000Z';

let conn: SqliteConnection;
let store: SqliteFactoryStore;

const ticketRow = (ticketId: string, machineId: string | null = 'z1'): FactoryTicketRow => ({
  ticketId, floorId: 'default', machineId, createdAt: NOW, updatedAt: NOW,
  state: { x: 1, y: 2, phase: 'zone', p: 0, fx: 1, fy: 0, outcome: '', released: false, since: NOW, runId: null, note: '' },
});
const runRow = (id: string, over: Partial<FactoryRunRow> = {}): FactoryRunRow => ({
  id, ticketId: 't-1', floorId: 'default', machineId: 's1', machineName: 'Spec', executor: 'agent', status: 'running',
  outcome: null, executionId: null, error: null, startedAt: NOW, finishedAt: null, ...over,
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
  store = new SqliteFactoryStore(conn);
  await store.saveFloor({ id: 'default', name: 'Factory', layout: { w: 20, h: 10, machines: [] }, settings: { ...DEFAULT_SETTINGS }, createdAt: NOW, updatedAt: NOW });
});

afterEach(() => conn.close());

describe('SqliteFactoryStore', () => {
  it('round-trips a floor, with its layout and settings as objects', async () => {
    await store.saveFloor({
      id: 'default', name: 'Atelier', settings: { maxRunsPerHour: 5, maxConcurrentRuns: 2 }, createdAt: NOW, updatedAt: NOW,
      layout: { w: 20, h: 10, machines: [{ id: 'b1', kind: 'belt', x: 1, y: 1, w: 1, h: 1, dir: 0 }] },
    });
    const floor = await store.getFloor('default');
    expect(floor?.name).toBe('Atelier');
    expect(floor?.layout.machines).toEqual([{ id: 'b1', kind: 'belt', x: 1, y: 1, w: 1, h: 1, dir: 0 }]);
    expect(floor?.settings.maxRunsPerHour).toBe(5);
    expect(await store.getFloor('nope')).toBeNull();
  });

  it('saves a ticket position as an upsert, and lists the managed ids', async () => {
    await store.saveTicket(ticketRow('t-1'));
    await store.saveTicket({ ...ticketRow('t-1', 's1'), state: { ...ticketRow('t-1').state, phase: 'running', runId: 'r1' } });
    const rows = await store.listTickets('default');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.machineId).toBe('s1');
    expect(rows[0]?.state.phase).toBe('running');
    expect(await store.listManagedTicketIds()).toEqual(['t-1']);
    await store.removeTicket('t-1');
    expect(await store.listManagedTicketIds()).toEqual([]);
  });

  it('counts only agent runs towards the hourly limit, and flags runs left running', async () => {
    await store.saveRun(runRow('r1'));
    await store.saveRun(runRow('r2', { executor: 'human_gate', status: 'needs_review' }));
    await store.saveRun(runRow('r3', { startedAt: '2026-11-15T08:00:00.000Z', status: 'completed', outcome: 'ok', finishedAt: '2026-11-15T08:05:00.000Z' }));
    expect(await store.countRunsSince('default', '2026-11-15T09:30:00.000Z')).toBe(1);
    const interrupted = await store.interruptRunningRuns('2026-11-15T11:00:00.000Z');
    expect(interrupted.map((r) => r.id)).toEqual(['r1']);
    const runs = await store.listRunsByTicket('t-1');
    expect(runs.map((r) => [r.id, r.status])).toEqual([['r3', 'completed'], ['r1', 'interrupted'], ['r2', 'needs_review']]);
    expect((await store.listRecentRuns('default', 1))[0]?.id).toMatch(/r[12]/);
  });

  it("lists one machine's latest runs, newest first, in SQL", async () => {
    await store.saveRun(runRow('a1', { machineId: 'm-a', startedAt: '2026-11-15T08:00:00.000Z' }));
    await store.saveRun(runRow('b1', { machineId: 'm-b', startedAt: '2026-11-15T09:00:00.000Z' }));
    await store.saveRun(runRow('a2', { machineId: 'm-a', startedAt: '2026-11-15T10:00:00.000Z' }));
    expect((await store.listRecentRuns('default', 10, 'm-a')).map((r) => r.id)).toEqual(['a2', 'a1']);
    expect((await store.listRecentRuns('default', 1, 'm-a')).map((r) => r.id)).toEqual(['a2']);
    expect((await store.listRecentRuns('default', 10)).map((r) => r.id)).toEqual(['a2', 'b1', 'a1']);
  });

  it('lists what started or ended in a period, oldest first, for the stats', async () => {
    await store.saveRun(runRow('old', { startedAt: '2026-11-01T08:00:00.000Z', status: 'completed', finishedAt: '2026-11-01T08:05:00.000Z' }));
    await store.saveRun(runRow('recent', { startedAt: '2026-11-15T09:00:00.000Z', status: 'completed', outcome: 'ok', finishedAt: '2026-11-15T09:05:00.000Z' }));
    /* an exit row starts when the ticket was handed over: it counts for the period it ended in */
    await store.saveRun(runRow('shipped', { executor: 'exit', machineId: 'out', startedAt: '2026-11-02T08:00:00.000Z', status: 'completed', outcome: 'shipped', finishedAt: '2026-11-15T09:30:00.000Z' }));
    const rows = await store.listRunsSince('default', '2026-11-10T00:00:00.000Z');
    expect(rows.map((r) => [r.id, r.executor])).toEqual([['shipped', 'exit'], ['recent', 'agent']]);
    expect(await store.countRunsSince('default', '2026-11-01T00:00:00.000Z')).toBe(2);
    expect(await store.listRunsSince('other-floor', '2026-11-01T00:00:00.000Z')).toEqual([]);
  });

  it('drops a ticket’s Factory rows when the ticket is deleted', async () => {
    await store.saveTicket(ticketRow('t-1'));
    await store.saveRun(runRow('r1'));
    conn.db.exec("DELETE FROM tickets WHERE id = 't-1'");
    expect(await store.listTickets('default')).toEqual([]);
    expect(await store.listRunsByTicket('t-1')).toEqual([]);
  });

  it('round-trips an item, finds it by its key archived or not, and counts what each intake dropped', async () => {
    const item = (id: string, over: Partial<FactoryItemRow> = {}): FactoryItemRow => ({
      id, floorId: 'default', source: 'slack', sourceKey: `T1/C1/${id}`, title: 'hi', author: 'Ana', excerpt: 'can you look', url: 'https://x.slack.com/a',
      tags: ['team:ops'], fields: { channel: '#ops', labels: ['INBOX'], bot: false }, messages: 1, lastActivityAt: NOW, intakeId: 'in1', machineId: 'in1',
      state: { x: 1, y: 2, phase: 'zone', p: 0, fx: 1, fy: 0, outcome: '', released: false, since: NOW, runId: null, note: '' },
      archivedAt: null, archivedReason: null, createdAt: NOW, updatedAt: NOW, ...over,
    });
    await store.saveItem(item('i1'));
    await store.saveItem(item('i1', { messages: 3, title: 'the real ask' }));
    await store.saveItem(item('i2', { archivedAt: NOW, archivedReason: 'dropped', machineId: null, state: null }));
    await store.saveItem(item('i3', { archivedAt: NOW, archivedReason: 'dropped', machineId: null, state: null }));
    expect(await store.listItems('default')).toEqual([item('i1', { messages: 3, title: 'the real ask' })]);
    expect(await store.getItemByKey('slack', 'T1/C1/i2')).toMatchObject({ id: 'i2', archivedReason: 'dropped', state: null });
    expect(await store.getItemByKey('gmail', 'T1/C1/i2')).toBeNull();
    expect(await store.countDropped('default', '2026-11-15T00:00:00.000Z')).toEqual({ in1: 2 });
    expect(await store.countDropped('default', '2026-11-16T00:00:00.000Z')).toEqual({});
  });

  it('keeps an item\'s visits apart from tickets\' runs, with what the station answered, and flags them after a restart', async () => {
    const nowState = { x: 1, y: 2, phase: 'zone' as const, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: NOW, runId: null, note: '' };
    await store.saveItem({ id: 'i1', floorId: 'default', source: 'manual', sourceKey: 'k', title: 'hi', author: '', excerpt: '', url: null, tags: [], fields: {}, messages: 1, lastActivityAt: NOW, intakeId: null, machineId: null, state: nowState, archivedAt: null, archivedReason: null, createdAt: NOW, updatedAt: NOW });
    await store.saveItemRun(runRow('v1', { ticketId: 'i1', reply: null, deliverableId: null }));
    await store.saveItemRun(runRow('v1', { ticketId: 'i1', status: 'completed', outcome: 'mine', reply: 'Answer Ana.', deliverableId: 'd1', finishedAt: NOW }));
    await store.saveItemRun(runRow('v2', { ticketId: 'i1', reply: null, deliverableId: null, startedAt: '2026-11-15T11:00:00.000Z' }));
    expect(await store.listItemRuns('i1')).toMatchObject([{ id: 'v1', ticketId: 'i1', status: 'completed', outcome: 'mine', reply: 'Answer Ana.', deliverableId: 'd1' }, { id: 'v2', status: 'running' }]);
    expect(await store.listRunsByTicket('i1')).toEqual([]);
    expect((await store.interruptRunningRuns(NOW)).map((r) => r.id)).toEqual(['v2']);
    expect((await store.listItemRuns('i1'))[1]).toMatchObject({ status: 'interrupted' });
  });

  it('lists the items archived at an exit since a time', async () => {
    const base = { floorId: 'default', source: 'gmail' as const, title: 't', author: '', excerpt: '', url: null, tags: [], fields: {}, messages: 1, lastActivityAt: NOW, intakeId: null, state: null, createdAt: NOW, updatedAt: NOW };
    await store.saveItem({ ...base, id: 'e1', sourceKey: 'k1', machineId: 'out', archivedAt: '2026-11-15T12:00:00.000Z', archivedReason: 'exit' });
    await store.saveItem({ ...base, id: 'e2', sourceKey: 'k2', machineId: 'out', archivedAt: '2026-11-14T12:00:00.000Z', archivedReason: 'exit' });
    await store.saveItem({ ...base, id: 'j1', sourceKey: 'k3', machineId: null, archivedAt: '2026-11-15T12:00:00.000Z', archivedReason: 'junk' });
    await store.saveItem({ ...base, id: 'o1', sourceKey: 'k4', machineId: 'other', archivedAt: '2026-11-15T12:00:00.000Z', archivedReason: 'exit' });
    expect((await store.listExitItems('default', 'out', '2026-11-13T00:00:00.000Z')).map((i) => i.id)).toEqual(['e1', 'e2']);
    expect((await store.listExitItems('default', 'out', '2026-11-15T00:00:00.000Z')).map((i) => i.id)).toEqual(['e1']);
    expect((await store.listExitItems('default', null, '2026-11-13T00:00:00.000Z')).map((i) => i.id).sort()).toEqual(['e1', 'e2', 'o1']);
  });

  it('keeps the whole of an item\'s latest message apart, over the one before', async () => {
    const base = { floorId: 'default', source: 'gmail' as const, sourceKey: 'b1', title: 't', author: '', excerpt: '', url: null, tags: [], fields: {}, messages: 1, lastActivityAt: NOW, intakeId: null, machineId: null, state: null, archivedAt: null, archivedReason: null, createdAt: NOW, updatedAt: NOW };
    await store.saveItem({ ...base, id: 'b1' });
    expect(await store.getItemBody('b1')).toBeNull();
    await store.saveItemBody('b1', { text: 'first', html: '<p>first</p>' });
    await store.saveItemBody('b1', { text: 'second', html: null });
    expect(await store.getItemBody('b1')).toEqual({ text: 'second', html: null });
  });

  it('keeps where each pulled intake stands, by floor', async () => {
    await store.saveIntakePull({ intakeId: 'in1', floorId: 'default', lastPulledAt: NOW, error: null, updatedAt: NOW });
    await store.saveIntakePull({ intakeId: 'in1', floorId: 'default', lastPulledAt: NOW, error: 'rate limited', updatedAt: '2026-11-15T13:00:00.000Z' });
    await store.saveIntakePull({ intakeId: 'in2', floorId: 'other', lastPulledAt: null, error: null, updatedAt: NOW });
    expect(await store.listIntakePulls('default')).toEqual([{ intakeId: 'in1', floorId: 'default', lastPulledAt: NOW, error: 'rate limited', updatedAt: '2026-11-15T13:00:00.000Z' }]);
    expect(await store.listIntakePulls('other')).toEqual([{ intakeId: 'in2', floorId: 'other', lastPulledAt: null, error: null, updatedAt: NOW }]);
  });

  it('down() removes the seven tables and nothing else', async () => {
    const tables = () => (conn.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'factory_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables()).toEqual(['factory_floors', 'factory_intake_pulls', 'factory_item_bodies', 'factory_item_runs', 'factory_items', 'factory_runs', 'factory_tickets']);
    const before = (conn.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
    await bodiesMigration.down({ adapter: 'sqlite', exec: async (sql: string) => { conn.db.exec(sql); }, query: async () => [], dialect: (d: { sqlite: unknown }) => d.sqlite } as never);
    await pullsMigration.down({ adapter: 'sqlite', exec: async (sql: string) => { conn.db.exec(sql); }, query: async () => [], dialect: (d: { sqlite: unknown }) => d.sqlite } as never);
    await itemRunsMigration.down({ adapter: 'sqlite', exec: async (sql: string) => { conn.db.exec(sql); }, query: async () => [], dialect: (d: { sqlite: unknown }) => d.sqlite } as never);
    await itemsMigration.down({ adapter: 'sqlite', exec: async (sql: string) => { conn.db.exec(sql); }, query: async () => [], dialect: (d: { sqlite: unknown }) => d.sqlite } as never);
    await factoryMigration.down({ adapter: 'sqlite', exec: async (sql: string) => { conn.db.exec(sql); }, query: async () => [], dialect: (d: { sqlite: unknown }) => d.sqlite } as never);
    expect(tables()).toEqual([]);
    expect((conn.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n).toBe(before - 7);
  });
});
