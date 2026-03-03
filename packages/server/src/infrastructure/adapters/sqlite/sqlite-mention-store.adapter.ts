import type { MentionStatus } from '@asm/shared';
import { TicketMentionEntity } from '../../../domain/entities/ticket-mention.entity.js';
import type { MentionStorePort } from '../../../application/ports/mention-store.port.js';
import type { SqliteConnection } from './connection.js';

interface MentionRow {
  id: string;
  ticket_id: string;
  comment_id: string;
  target_agent: string;
  source_agent: string;
  target_type: string | null;
  status: string;
  resolved_at: string | null;
  resolved_comment_id: string | null;
  resolved_deliverable_id: string | null;
  created_at: string;
}

export class SqliteMentionStoreAdapter implements MentionStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getByTicket(ticketId: string): Promise<TicketMentionEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM mentions WHERE ticket_id = ? ORDER BY created_at ASC')
      .all(ticketId) as MentionRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<TicketMentionEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM mentions WHERE id = ?')
      .get(id) as MentionRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getByComment(commentId: string): Promise<TicketMentionEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM mentions WHERE comment_id = ?')
      .all(commentId) as MentionRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getPendingForAgent(agentName: string): Promise<TicketMentionEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM mentions WHERE target_agent = ? AND status != ? ORDER BY created_at ASC')
      .all(agentName, 'resolved') as MentionRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getPendingCountForTicket(ticketId: string): Promise<number> {
    const row = this.conn.db
      .prepare('SELECT COUNT(*) as cnt FROM mentions WHERE ticket_id = ? AND status != ?')
      .get(ticketId, 'resolved') as { cnt: number };
    return row.cnt;
  }

  async save(mention: TicketMentionEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO mentions
        (id, ticket_id, comment_id, target_agent, source_agent, target_type, status,
         resolved_at, resolved_comment_id, resolved_deliverable_id, created_at)
      VALUES
        (@id, @ticket_id, @comment_id, @target_agent, @source_agent, @target_type, @status,
         @resolved_at, @resolved_comment_id, @resolved_deliverable_id, @created_at)
    `);

    stmt.run({
      id: mention.id,
      ticket_id: mention.ticketId,
      comment_id: mention.commentId,
      target_agent: mention.targetAgent,
      source_agent: mention.sourceAgent,
      target_type: mention.targetType,
      status: mention.status,
      resolved_at: mention.resolvedAt?.toISOString() ?? null,
      resolved_comment_id: mention.resolvedCommentId,
      resolved_deliverable_id: mention.resolvedDeliverableId,
      created_at: mention.createdAt.toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM mentions WHERE id = ?').run(id);
  }

  private toEntity(row: MentionRow): TicketMentionEntity {
    return new TicketMentionEntity(
      row.id,
      row.ticket_id,
      row.comment_id,
      row.target_agent,
      row.source_agent,
      (row.target_type as 'agent' | 'human') ?? 'agent',
      row.status as MentionStatus,
      row.resolved_at ? new Date(row.resolved_at) : null,
      row.resolved_comment_id,
      row.resolved_deliverable_id,
      new Date(row.created_at),
    );
  }
}
