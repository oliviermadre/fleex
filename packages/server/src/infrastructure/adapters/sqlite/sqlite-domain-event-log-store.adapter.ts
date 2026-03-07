import { DomainEventLogEntity } from '../../../domain/entities/domain-event-log.entity.js';
import type { DomainEventLogStorePort } from '../../../application/ports/domain-event-log-store.port.js';
import type { SqliteConnection } from './connection.js';

interface EventLogRow {
  id: string;
  event_type: string;
  payload: string;
  instance_id: string;
  occurred_at: string;
}

export class SqliteDomainEventLogStoreAdapter implements DomainEventLogStorePort {
  constructor(private readonly conn: SqliteConnection) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.conn.db.exec(`
      CREATE TABLE IF NOT EXISTS domain_event_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_domain_event_log_occurred_at ON domain_event_log(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_domain_event_log_event_type ON domain_event_log(event_type);
    `);
  }

  async save(entry: DomainEventLogEntity): Promise<void> {
    this.conn.db
      .prepare(
        `INSERT OR REPLACE INTO domain_event_log (id, event_type, payload, instance_id, occurred_at)
         VALUES (@id, @event_type, @payload, @instance_id, @occurred_at)`,
      )
      .run({
        id: entry.id,
        event_type: entry.eventType,
        payload: JSON.stringify(entry.payload),
        instance_id: entry.instanceId,
        occurred_at: entry.occurredAt.toISOString(),
      });
  }

  async list(params: {
    limit: number;
    before?: string;
    eventType?: string;
    instanceId?: string;
    since?: Date;
    until?: Date;
  }): Promise<DomainEventLogEntity[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.before) {
      const cursor = this.conn.db
        .prepare('SELECT occurred_at FROM domain_event_log WHERE id = ?')
        .get(params.before) as { occurred_at: string } | undefined;
      if (cursor) {
        conditions.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))');
        values.push(cursor.occurred_at, cursor.occurred_at, params.before);
      }
    }

    if (params.eventType) {
      conditions.push('(event_type = ? OR event_type LIKE ?)');
      values.push(params.eventType, `${params.eventType}.%`);
    }

    if (params.instanceId) {
      conditions.push('instance_id = ?');
      values.push(params.instanceId);
    }

    if (params.since) {
      conditions.push('occurred_at >= ?');
      values.push(params.since.toISOString());
    }

    if (params.until) {
      conditions.push('occurred_at <= ?');
      values.push(params.until.toISOString());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM domain_event_log ${where} ORDER BY occurred_at DESC, id DESC LIMIT ?`;
    values.push(params.limit);

    const rows = this.conn.db.prepare(sql).all(...values) as EventLogRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async count(): Promise<number> {
    const row = this.conn.db
      .prepare('SELECT COUNT(*) as cnt FROM domain_event_log')
      .get() as { cnt: number };
    return row.cnt;
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const countRow = this.conn.db
      .prepare('SELECT COUNT(*) as cnt FROM domain_event_log WHERE occurred_at < ?')
      .get(date.toISOString()) as { cnt: number } | undefined;
    const count = countRow?.cnt ?? 0;
    this.conn.db
      .prepare('DELETE FROM domain_event_log WHERE occurred_at < ?')
      .run(date.toISOString());
    return count;
  }

  private toEntity(row: EventLogRow): DomainEventLogEntity {
    return new DomainEventLogEntity(
      row.id,
      row.event_type,
      JSON.parse(row.payload) as Record<string, unknown>,
      row.instance_id,
      new Date(row.occurred_at),
    );
  }
}
