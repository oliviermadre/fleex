import { TicketDeliverableEntity } from '../../../domain/entities/ticket-deliverable.entity.js';
import type { DeliverableStorePort } from '../../../application/ports/deliverable-store.port.js';
import type { SqliteConnection } from './connection.js';

interface DeliverableRow {
  id: string;
  ticket_id: string;
  agent_name: string;
  type: string;
  title: string;
  content: string;
  version: number;
  status: string;
  mention_id: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteDeliverableStoreAdapter implements DeliverableStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM deliverables WHERE ticket_id = ? ORDER BY created_at ASC')
      .all(ticketId) as DeliverableRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<TicketDeliverableEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM deliverables WHERE id = ?')
      .get(id) as DeliverableRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getAll(): Promise<TicketDeliverableEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM deliverables ORDER BY created_at ASC')
      .all() as DeliverableRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async save(deliverable: TicketDeliverableEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO deliverables
        (id, ticket_id, agent_name, type, title, content, version, status,
         mention_id, created_at, updated_at)
      VALUES
        (@id, @ticket_id, @agent_name, @type, @title, @content, @version, @status,
         @mention_id, @created_at, @updated_at)
    `);

    stmt.run({
      id: deliverable.id,
      ticket_id: deliverable.ticketId,
      agent_name: deliverable.agentName,
      type: deliverable.type,
      title: deliverable.title,
      content: deliverable.content,
      version: deliverable.version,
      status: deliverable.status,
      mention_id: deliverable.mentionId,
      created_at: deliverable.createdAt.toISOString(),
      updated_at: deliverable.updatedAt.toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM deliverables WHERE id = ?').run(id);
  }

  private toEntity(row: DeliverableRow): TicketDeliverableEntity {
    return new TicketDeliverableEntity(
      row.id,
      row.ticket_id,
      row.agent_name,
      row.type,
      row.title,
      row.content,
      row.version,
      row.status as 'draft' | 'final',
      row.mention_id,
      new Date(row.created_at),
      new Date(row.updated_at),
    );
  }
}
