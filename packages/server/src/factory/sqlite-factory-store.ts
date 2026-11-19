import type { SqliteConnection } from '../infrastructure/adapters/sqlite/connection.js';
import type { FactoryStorePort } from './factory-store.port.js';
import type { FactoryFloorRow, FactoryItemRow, FactoryRunRow, FactoryTicketRow, ItemSource, RunExecutor, FactoryRunStatus } from './types.js';

interface FloorRow { id: string; name: string; layout: string; settings: string; created_at: string; updated_at: string }
interface TicketRow { ticket_id: string; floor_id: string; machine_id: string | null; state: string; created_at: string; updated_at: string }
interface RunRow {
  id: string; ticket_id: string; floor_id: string; machine_id: string; machine_name: string; executor: string; status: string;
  outcome: string | null; execution_id: string | null; error: string | null; started_at: string; finished_at: string | null;
}

export interface ItemDbRow {
  id: string; floor_id: string; source: string; source_key: string; title: string; author: string; excerpt: string; url: string | null;
  tags: string | string[]; messages: number; last_activity_at: string; intake_id: string | null; machine_id: string | null; state: unknown;
  archived_at: string | null; archived_reason: string | null; created_at: string; updated_at: string;
}
const iso = (v: string | null): string | null => (v ? new Date(v).toISOString() : null);
/** A row of `factory_items` as either driver returns it: JSON columns as text (SQLite) or already parsed (Postgres). */
export function itemFromRow(r: ItemDbRow): FactoryItemRow {
  const parse = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
  return {
    id: r.id, floorId: r.floor_id, source: r.source as ItemSource, sourceKey: r.source_key, title: r.title, author: r.author, excerpt: r.excerpt,
    url: r.url, tags: parse<string[]>(r.tags) ?? [], messages: Number(r.messages) || 1, lastActivityAt: iso(r.last_activity_at)!,
    intakeId: r.intake_id, machineId: r.machine_id, state: r.state == null ? null : parse(r.state),
    archivedAt: iso(r.archived_at), archivedReason: (r.archived_reason as FactoryItemRow['archivedReason']) ?? null,
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  };
}
export function itemToRow(i: FactoryItemRow, json: (v: unknown) => unknown): ItemDbRow {
  return {
    id: i.id, floor_id: i.floorId, source: i.source, source_key: i.sourceKey, title: i.title, author: i.author, excerpt: i.excerpt, url: i.url,
    tags: json(i.tags) as string, messages: i.messages, last_activity_at: i.lastActivityAt, intake_id: i.intakeId, machine_id: i.machineId,
    state: i.state == null ? null : json(i.state), archived_at: i.archivedAt, archived_reason: i.archivedReason, created_at: i.createdAt, updated_at: i.updatedAt,
  };
}

export function runFromRow(r: RunRow): FactoryRunRow {
  return {
    id: r.id, ticketId: r.ticket_id, floorId: r.floor_id, machineId: r.machine_id, machineName: r.machine_name,
    executor: r.executor as RunExecutor, status: r.status as FactoryRunStatus, outcome: r.outcome, executionId: r.execution_id,
    error: r.error, startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  };
}

export class SqliteFactoryStore implements FactoryStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getFloor(id: string): Promise<FactoryFloorRow | null> {
    const r = this.conn.db.prepare('SELECT * FROM factory_floors WHERE id = ?').get(id) as FloorRow | undefined;
    return r ? { id: r.id, name: r.name, layout: JSON.parse(r.layout), settings: JSON.parse(r.settings), createdAt: r.created_at, updatedAt: r.updated_at } : null;
  }

  async saveFloor(f: FactoryFloorRow): Promise<void> {
    this.conn.db.prepare(`
      INSERT INTO factory_floors (id, name, layout, settings, created_at, updated_at)
      VALUES (@id, @name, @layout, @settings, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, layout = excluded.layout, settings = excluded.settings, updated_at = excluded.updated_at
    `).run({ id: f.id, name: f.name, layout: JSON.stringify(f.layout), settings: JSON.stringify(f.settings), created_at: f.createdAt, updated_at: f.updatedAt });
  }

  async listTickets(floorId: string): Promise<FactoryTicketRow[]> {
    const rows = this.conn.db.prepare('SELECT * FROM factory_tickets WHERE floor_id = ? ORDER BY created_at ASC').all(floorId) as TicketRow[];
    return rows.map((r) => ({ ticketId: r.ticket_id, floorId: r.floor_id, machineId: r.machine_id, state: JSON.parse(r.state), createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async saveTicket(t: FactoryTicketRow): Promise<void> {
    this.conn.db.prepare(`
      INSERT INTO factory_tickets (ticket_id, floor_id, machine_id, state, created_at, updated_at)
      VALUES (@ticket_id, @floor_id, @machine_id, @state, @created_at, @updated_at)
      ON CONFLICT(ticket_id) DO UPDATE SET floor_id = excluded.floor_id, machine_id = excluded.machine_id, state = excluded.state, updated_at = excluded.updated_at
    `).run({ ticket_id: t.ticketId, floor_id: t.floorId, machine_id: t.machineId, state: JSON.stringify(t.state), created_at: t.createdAt, updated_at: t.updatedAt });
  }

  async removeTicket(ticketId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM factory_tickets WHERE ticket_id = ?').run(ticketId);
  }

  async listManagedTicketIds(): Promise<string[]> {
    return (this.conn.db.prepare('SELECT ticket_id FROM factory_tickets').all() as { ticket_id: string }[]).map((r) => r.ticket_id);
  }

  async listItems(floorId: string): Promise<FactoryItemRow[]> {
    return (this.conn.db.prepare('SELECT * FROM factory_items WHERE floor_id = ? AND archived_at IS NULL ORDER BY created_at ASC').all(floorId) as ItemDbRow[]).map(itemFromRow);
  }

  async getItemByKey(source: string, sourceKey: string): Promise<FactoryItemRow | null> {
    const r = this.conn.db.prepare('SELECT * FROM factory_items WHERE source = ? AND source_key = ?').get(source, sourceKey) as ItemDbRow | undefined;
    return r ? itemFromRow(r) : null;
  }

  async saveItem(i: FactoryItemRow): Promise<void> {
    this.conn.db.prepare(`
      INSERT INTO factory_items (id, floor_id, source, source_key, title, author, excerpt, url, tags, messages, last_activity_at, intake_id, machine_id, state, archived_at, archived_reason, created_at, updated_at)
      VALUES (@id, @floor_id, @source, @source_key, @title, @author, @excerpt, @url, @tags, @messages, @last_activity_at, @intake_id, @machine_id, @state, @archived_at, @archived_reason, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, author = excluded.author, excerpt = excluded.excerpt, url = excluded.url, tags = excluded.tags,
        messages = excluded.messages, last_activity_at = excluded.last_activity_at, intake_id = excluded.intake_id, machine_id = excluded.machine_id,
        state = excluded.state, archived_at = excluded.archived_at, archived_reason = excluded.archived_reason, updated_at = excluded.updated_at
    `).run(itemToRow(i, (v) => JSON.stringify(v)) as unknown as Record<string, unknown>);
  }

  async countDropped(floorId: string, sinceIso: string): Promise<Record<string, number>> {
    const rows = this.conn.db.prepare("SELECT intake_id, COUNT(*) AS n FROM factory_items WHERE floor_id = ? AND archived_reason = 'dropped' AND archived_at >= ? GROUP BY intake_id").all(floorId, sinceIso) as { intake_id: string | null; n: number }[];
    return Object.fromEntries(rows.filter((r) => r.intake_id).map((r) => [r.intake_id!, r.n]));
  }

  async saveRun(r: FactoryRunRow): Promise<void> {
    this.conn.db.prepare(`
      INSERT INTO factory_runs (id, ticket_id, floor_id, machine_id, machine_name, executor, status, outcome, execution_id, error, started_at, finished_at)
      VALUES (@id, @ticket_id, @floor_id, @machine_id, @machine_name, @executor, @status, @outcome, @execution_id, @error, @started_at, @finished_at)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, outcome = excluded.outcome, execution_id = excluded.execution_id, error = excluded.error, finished_at = excluded.finished_at
    `).run({
      id: r.id, ticket_id: r.ticketId, floor_id: r.floorId, machine_id: r.machineId, machine_name: r.machineName, executor: r.executor, status: r.status,
      outcome: r.outcome, execution_id: r.executionId, error: r.error, started_at: r.startedAt, finished_at: r.finishedAt,
    });
  }

  async listRunsByTicket(ticketId: string): Promise<FactoryRunRow[]> {
    return (this.conn.db.prepare('SELECT * FROM factory_runs WHERE ticket_id = ? ORDER BY started_at ASC').all(ticketId) as RunRow[]).map(runFromRow);
  }

  async listRecentRuns(floorId: string, limit: number): Promise<FactoryRunRow[]> {
    return (this.conn.db.prepare('SELECT * FROM factory_runs WHERE floor_id = ? ORDER BY started_at DESC LIMIT ?').all(floorId, limit) as RunRow[]).map(runFromRow);
  }

  async listRunsSince(floorId: string, sinceIso: string): Promise<FactoryRunRow[]> {
    return (this.conn.db.prepare('SELECT * FROM factory_runs WHERE floor_id = ? AND (started_at >= ? OR finished_at >= ?) ORDER BY started_at ASC LIMIT 10000').all(floorId, sinceIso, sinceIso) as RunRow[]).map(runFromRow);
  }

  async countRunsSince(floorId: string, sinceIso: string): Promise<number> {
    const r = this.conn.db.prepare("SELECT COUNT(*) AS n FROM factory_runs WHERE floor_id = ? AND started_at >= ? AND executor IN ('agent', 'skill', 'panel')").get(floorId, sinceIso) as { n: number };
    return r.n;
  }

  async interruptRunningRuns(nowIso: string): Promise<FactoryRunRow[]> {
    const rows = this.conn.db.prepare("SELECT * FROM factory_runs WHERE status = 'running'").all() as RunRow[];
    if (rows.length) this.conn.db.prepare("UPDATE factory_runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'").run(nowIso);
    return rows.map(runFromRow).map((r) => ({ ...r, status: 'interrupted' as const, finishedAt: nowIso }));
  }
}
