import type { MentionStatus } from '@fleex/shared';
import { TicketMentionEntity } from '../../../domain/entities/ticket-mention.entity.js';
import type { MentionStorePort } from '../../../application/ports/mention-store.port.js';
import type { PgConnection } from './connection.js';

export class PgMentionStore implements MentionStorePort {
  constructor(private readonly db: PgConnection) {}

  async getByTicket(ticketId: string): Promise<TicketMentionEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM mentions WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticketId],
    );
    return rows.map(rowToMention);
  }

  async getById(id: string): Promise<TicketMentionEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM mentions WHERE id = $1', [id]);
    return rows.length > 0 ? rowToMention(rows[0]) : null;
  }

  async getAll(): Promise<TicketMentionEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM mentions ORDER BY created_at ASC',
    );
    return rows.map(rowToMention);
  }

  async getByComment(commentId: string): Promise<TicketMentionEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM mentions WHERE comment_id = $1',
      [commentId],
    );
    return rows.map(rowToMention);
  }

  async getPendingForAgent(agentName: string): Promise<TicketMentionEntity[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM mentions WHERE target_agent = $1 AND status NOT IN ('resolved', 'waiting_for_info') ORDER BY created_at ASC`,
      [agentName],
    );
    return rows.map(rowToMention);
  }

  async getPendingCountForTicket(ticketId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS count FROM mentions WHERE ticket_id = $1 AND status != 'resolved'`,
      [ticketId],
    );
    return (rows[0]?.count as number) ?? 0;
  }

  async getWaitingByTicket(ticketId: string): Promise<TicketMentionEntity[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM mentions WHERE ticket_id = $1 AND status = 'waiting_for_info' ORDER BY created_at ASC`,
      [ticketId],
    );
    return rows.map(rowToMention);
  }

  async save(mention: TicketMentionEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO mentions (
        id, ticket_id, comment_id, target_agent, source_agent, target_type, execution_mode,
        status, resolved_at, resolved_comment_id, resolved_deliverable_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        ticket_id = $2,
        comment_id = $3,
        target_agent = $4,
        source_agent = $5,
        target_type = $6,
        execution_mode = $7,
        status = $8,
        resolved_at = $9,
        resolved_comment_id = $10,
        resolved_deliverable_id = $11,
        created_at = $12`,
      [
        mention.id,
        mention.ticketId,
        mention.commentId,
        mention.targetAgent,
        mention.sourceAgent,
        mention.targetType,
        mention.executionMode,
        mention.status,
        mention.resolvedAt?.toISOString() ?? null,
        mention.resolvedCommentId,
        mention.resolvedDeliverableId,
        mention.createdAt.toISOString(),
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM mentions WHERE id = $1', [id]);
  }
}

function rowToMention(row: Record<string, unknown>): TicketMentionEntity {
  return new TicketMentionEntity(
    row.id as string,
    row.ticket_id as string,
    row.comment_id as string,
    row.target_agent as string,
    row.source_agent as string,
    (row.target_type as 'agent' | 'human') ?? 'agent',
    ((row.execution_mode as string) ?? 'plan') as 'talk' | 'plan' | 'edit',
    (row.status as MentionStatus) ?? 'pending',
    row.resolved_at ? new Date(row.resolved_at as string) : null,
    (row.resolved_comment_id as string) ?? null,
    (row.resolved_deliverable_id as string) ?? null,
    new Date(row.created_at as string),
  );
}
