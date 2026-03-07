import { DomainEventLogEntity } from '../../../domain/entities/domain-event-log.entity.js';
import type { DomainEventLogStorePort } from '../../../application/ports/domain-event-log-store.port.js';
import type { PgConnection } from './connection.js';

export class PgDomainEventLogStore implements DomainEventLogStorePort {
  constructor(private readonly db: PgConnection) {}

  async init(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS domain_event_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        instance_id TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_domain_event_log_occurred_at ON domain_event_log(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_domain_event_log_event_type ON domain_event_log(event_type);
    `);
  }

  async save(entry: DomainEventLogEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO domain_event_log (id, event_type, payload, instance_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [entry.id, entry.eventType, JSON.stringify(entry.payload), entry.instanceId, entry.occurredAt.toISOString()],
    );
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
    let paramIdx = 1;

    if (params.before) {
      conditions.push(`(occurred_at, id) < (
        (SELECT occurred_at FROM domain_event_log WHERE id = $${paramIdx}),
        $${paramIdx}
      )`);
      values.push(params.before);
      paramIdx++;
    }

    if (params.eventType) {
      conditions.push(`(event_type = $${paramIdx} OR event_type LIKE $${paramIdx + 1})`);
      values.push(params.eventType, `${params.eventType}.%`);
      paramIdx += 2;
    }

    if (params.instanceId) {
      conditions.push(`instance_id = $${paramIdx}`);
      values.push(params.instanceId);
      paramIdx++;
    }

    if (params.since) {
      conditions.push(`occurred_at >= $${paramIdx}`);
      values.push(params.since.toISOString());
      paramIdx++;
    }

    if (params.until) {
      conditions.push(`occurred_at <= $${paramIdx}`);
      values.push(params.until.toISOString());
      paramIdx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM domain_event_log ${where} ORDER BY occurred_at DESC, id DESC LIMIT $${paramIdx}`;
    values.push(params.limit);

    const { rows } = await this.db.query(sql, values);
    return rows.map(rowToEntity);
  }

  async count(): Promise<number> {
    const { rows } = await this.db.query('SELECT COUNT(*)::int as cnt FROM domain_event_log');
    return rows[0]?.cnt ?? 0;
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const { rows } = await this.db.query(
      'WITH deleted AS (DELETE FROM domain_event_log WHERE occurred_at < $1 RETURNING 1) SELECT COUNT(*)::int as cnt FROM deleted',
      [date.toISOString()],
    );
    return rows[0]?.cnt ?? 0;
  }
}

function rowToEntity(row: Record<string, unknown>): DomainEventLogEntity {
  return new DomainEventLogEntity(
    row.id as string,
    row.event_type as string,
    (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>,
    row.instance_id as string,
    new Date(row.occurred_at as string),
  );
}
