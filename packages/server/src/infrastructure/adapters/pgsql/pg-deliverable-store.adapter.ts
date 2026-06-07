import type { DeliverableType, DeliverableStatus } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../../domain/entities/ticket-deliverable.entity.js';
import type { DeliverableStorePort } from '../../../application/ports/deliverable-store.port.js';
import type { PgConnection } from './connection.js';

export class PgDeliverableStore implements DeliverableStorePort {
  constructor(private readonly db: PgConnection) {}

  async getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticketId],
    );
    return rows.map(rowToDeliverable);
  }

  async getByTicketIds(ticketIds: string[]): Promise<TicketDeliverableEntity[]> {
    if (ticketIds.length === 0) return [];
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE ticket_id = ANY($1::text[]) ORDER BY created_at ASC',
      [ticketIds],
    );
    return rows.map(rowToDeliverable);
  }

  async getById(id: string): Promise<TicketDeliverableEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM deliverables WHERE id = $1', [id]);
    return rows.length > 0 ? rowToDeliverable(rows[0]) : null;
  }

  async getAll(): Promise<TicketDeliverableEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM deliverables ORDER BY created_at ASC');
    return rows.map(rowToDeliverable);
  }

  async getByTicketAndType(ticketId: string, type: string): Promise<TicketDeliverableEntity | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE ticket_id = $1 AND type = $2 LIMIT 1',
      [ticketId, type],
    );
    return rows.length > 0 ? rowToDeliverable(rows[0]) : null;
  }

  async getAllByType(type: string): Promise<TicketDeliverableEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE type = $1 ORDER BY created_at ASC',
      [type],
    );
    return rows.map(rowToDeliverable);
  }

  async save(deliverable: TicketDeliverableEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO deliverables (
        id, ticket_id, agent_name, type, title, content,
        version, status, mention_id, created_at, updated_at,
        last_edited_at, last_edited_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET
        ticket_id = $2,
        agent_name = $3,
        type = $4,
        title = $5,
        content = $6,
        version = $7,
        status = $8,
        mention_id = $9,
        created_at = $10,
        updated_at = $11,
        last_edited_at = $12,
        last_edited_by = $13`,
      [
        deliverable.id,
        deliverable.ticketId,
        deliverable.agentName,
        deliverable.type,
        deliverable.title,
        deliverable.content,
        deliverable.version,
        deliverable.status,
        deliverable.mentionId,
        deliverable.createdAt.toISOString(),
        deliverable.updatedAt.toISOString(),
        deliverable.lastEditedAt?.toISOString() ?? null,
        deliverable.lastEditedBy,
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM deliverables WHERE id = $1', [id]);
  }
}

function rowToDeliverable(row: Record<string, unknown>): TicketDeliverableEntity {
  return new TicketDeliverableEntity(
    row.id as string,
    row.ticket_id as string,
    row.agent_name as string,
    row.type as DeliverableType,
    row.title as string,
    row.content as string,
    (row.version as number) ?? 1,
    (row.status as DeliverableStatus) ?? 'draft',
    (row.mention_id as string) ?? null,
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
    row.last_edited_at ? new Date(row.last_edited_at as string) : null,
    (row.last_edited_by as string) ?? null,
  );
}
