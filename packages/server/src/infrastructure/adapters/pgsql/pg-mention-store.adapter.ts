import type { MentionStatus } from '@asm/shared';
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

  async getByComment(commentId: string): Promise<TicketMentionEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM mentions WHERE comment_id = $1',
      [commentId],
    );
    return rows.map(rowToMention);
  }

  async getPendingForAgent(agentName: string): Promise<TicketMentionEntity[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM mentions WHERE target_agent = $1 AND status != 'resolved' ORDER BY created_at ASC`,
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

  async save(mention: TicketMentionEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO mentions (
        id, ticket_id, comment_id, target_agent, source_agent,
        status, resolved_at, resolved_comment_id, resolved_deliverable_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        ticket_id = $2,
        comment_id = $3,
        target_agent = $4,
        source_agent = $5,
        status = $6,
        resolved_at = $7,
        resolved_comment_id = $8,
        resolved_deliverable_id = $9,
        created_at = $10`,
      [
        mention.id,
        mention.ticketId,
        mention.commentId,
        mention.targetAgent,
        mention.sourceAgent,
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
    (row.status as MentionStatus) ?? 'pending',
    row.resolved_at ? new Date(row.resolved_at as string) : null,
    (row.resolved_comment_id as string) ?? null,
    (row.resolved_deliverable_id as string) ?? null,
    new Date(row.created_at as string),
  );
}
