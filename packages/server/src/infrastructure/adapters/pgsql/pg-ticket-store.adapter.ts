import type { TicketStatus, TicketLinkType, TicketLink, TicketPriority, GitHubIssueMetadata } from '@fleex/shared';
import { BoardEntity } from '../../../domain/entities/board.entity.js';
import { TicketEntity } from '../../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../../domain/entities/ticket-activity.entity.js';
import type { TicketStorePort } from '../../../application/ports/ticket-store.port.js';
import type { PgConnection } from './connection.js';

const MAX_ACTIVITY_ENTRIES = 5000;

export class PgTicketStore implements TicketStorePort {
  constructor(private readonly db: PgConnection) {}

  // ── Boards ──

  async getAllBoards(): Promise<BoardEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM boards');
    return rows.map(rowToBoard);
  }

  async getBoardById(id: string): Promise<BoardEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM boards WHERE id = $1', [id]);
    return rows.length > 0 ? rowToBoard(rows[0]) : null;
  }

  async saveBoard(board: BoardEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO boards (id, name, emoji, repository_org, repository_name, next_display_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         name = $2,
         emoji = $3,
         repository_org = $4,
         repository_name = $5,
         next_display_id = $6,
         created_at = $7,
         updated_at = $8`,
      [
        board.id,
        board.name,
        board.emoji,
        board.repositoryOrg,
        board.repositoryName,
        board.nextDisplayId,
        board.createdAt.toISOString(),
        board.updatedAt.toISOString(),
      ],
    );
  }

  async removeBoard(id: string): Promise<void> {
    await this.db.query('DELETE FROM boards WHERE id = $1', [id]);
  }

  async getNextDisplayId(boardId: string): Promise<number> {
    const { rows } = await this.db.query(
      'UPDATE boards SET next_display_id = next_display_id + 1 WHERE id = $1 RETURNING next_display_id',
      [boardId],
    );
    if (rows.length === 0) throw new Error(`Board not found: ${boardId}`);
    return (rows[0].next_display_id as number) - 1;
  }

  // ── Tickets ──

  async getAllTickets(): Promise<TicketEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM tickets');
    return rows.map(rowToTicket);
  }

  async getTicketById(id: string): Promise<TicketEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM tickets WHERE id = $1', [id]);
    return rows.length > 0 ? rowToTicket(rows[0]) : null;
  }

  async getTicketsByBoard(boardId: string): Promise<TicketEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM tickets WHERE board_id = $1 ORDER BY position ASC',
      [boardId],
    );
    return rows.map(rowToTicket);
  }

  async getTicketsByStatus(boardId: string, status: TicketStatus): Promise<TicketEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM tickets WHERE board_id = $1 AND status = $2 ORDER BY position ASC',
      [boardId, status],
    );
    return rows.map(rowToTicket);
  }

  async getTicketsLinkedTo(type: TicketLinkType, ref: string): Promise<TicketEntity[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM tickets WHERE links @> $1::jsonb`,
      [JSON.stringify([{ type, ref }])],
    );
    return rows.map(rowToTicket);
  }

  async saveTicket(ticket: TicketEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO tickets (
        id, board_id, display_id, title, description, status, priority, position,
        tags, links, blocked, favorite, due_date, assignee,
        agent_claimed_at, github_metadata, status_changed_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (id) DO UPDATE SET
        board_id = $2,
        display_id = $3,
        title = $4,
        description = $5,
        status = $6,
        priority = $7,
        position = $8,
        tags = $9,
        links = $10,
        blocked = $11,
        favorite = $12,
        due_date = $13,
        assignee = $14,
        agent_claimed_at = $15,
        github_metadata = $16,
        status_changed_at = $17,
        created_at = $18,
        updated_at = $19`,
      [
        ticket.id,
        ticket.boardId,
        ticket.displayId,
        ticket.title,
        ticket.description,
        ticket.status,
        ticket.priority,
        ticket.position,
        JSON.stringify(ticket.tags),
        JSON.stringify(ticket.links),
        ticket.blocked,
        ticket.favorite,
        ticket.dueDate?.toISOString() ?? null,
        ticket.assignee,
        ticket.agentClaimedAt?.toISOString() ?? null,
        ticket.githubMetadata ? JSON.stringify(ticket.githubMetadata) : null,
        ticket.statusChangedAt.toISOString(),
        ticket.createdAt.toISOString(),
        ticket.updatedAt.toISOString(),
      ],
    );
  }

  async removeTicket(id: string): Promise<void> {
    await this.db.query('DELETE FROM tickets WHERE id = $1', [id]);
  }

  async removeTicketsByBoard(boardId: string): Promise<void> {
    await this.db.query('DELETE FROM tickets WHERE board_id = $1', [boardId]);
  }

  // ── Agent queries ──

  async getNextTicketForAgent(boardId?: string): Promise<TicketEntity | null> {
    let sql = `SELECT * FROM tickets WHERE status = 'todo' AND blocked = false`;
    const params: unknown[] = [];

    if (boardId) {
      params.push(boardId);
      sql += ` AND board_id = $${params.length}`;
    }

    sql += ` ORDER BY
      CASE priority
        WHEN 'high' THEN 0
        WHEN 'medium' THEN 1
        WHEN 'low' THEN 2
        ELSE 3
      END,
      position ASC
      LIMIT 1`;

    const { rows } = await this.db.query(sql, params);
    return rows.length > 0 ? rowToTicket(rows[0]) : null;
  }

  async getClaimedByAgent(agentName: string): Promise<TicketEntity[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM tickets WHERE assignee = $1 AND status = 'doing'`,
      [agentName],
    );
    return rows.map(rowToTicket);
  }

  // ── Activity ──

  async saveActivity(entry: TicketActivityEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO ticket_activities (id, ticket_id, action, changes, actor_type, actor_name, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         ticket_id = $2,
         action = $3,
         changes = $4,
         actor_type = $5,
         actor_name = $6,
         source = $7,
         created_at = $8`,
      [
        entry.id,
        entry.ticketId,
        entry.action,
        JSON.stringify(entry.changes),
        entry.actorType,
        entry.actorName,
        entry.source,
        entry.createdAt.toISOString(),
      ],
    );

    // Cap total activity entries at MAX_ACTIVITY_ENTRIES
    await this.db.query(
      `DELETE FROM ticket_activities WHERE id IN (
        SELECT id FROM ticket_activities ORDER BY created_at DESC OFFSET $1
      )`,
      [MAX_ACTIVITY_ENTRIES],
    );
  }

  async getActivitiesByTicket(ticketId: string, limit = 50): Promise<TicketActivityEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM ticket_activities WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT $2',
      [ticketId, limit],
    );
    return rows.map(rowToActivity);
  }
}

function rowToBoard(row: Record<string, unknown>): BoardEntity {
  return new BoardEntity(
    row.id as string,
    row.name as string,
    row.emoji as string,
    (row.repository_org as string) ?? null,
    (row.repository_name as string) ?? null,
    (row.next_display_id as number) ?? 1,
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
  );
}

function rowToTicket(row: Record<string, unknown>): TicketEntity {
  return new TicketEntity(
    row.id as string,
    row.board_id as string,
    (row.display_id as number) ?? 0,
    row.title as string,
    (row.description as string) ?? '',
    row.status as TicketStatus,
    (row.priority as TicketPriority) ?? 'none',
    (row.position as number) ?? 0,
    (row.tags as string[]) ?? [],
    (row.links as TicketLink[]) ?? [],
    (row.blocked as boolean) ?? false,
    (row.favorite as boolean) ?? false,
    row.due_date ? new Date(row.due_date as string) : null,
    (row.assignee as string) ?? null,
    row.agent_claimed_at ? new Date(row.agent_claimed_at as string) : null,
    (row.github_metadata as GitHubIssueMetadata) ?? null,
    new Date(row.status_changed_at as string),
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
  );
}

function rowToActivity(row: Record<string, unknown>): TicketActivityEntity {
  return new TicketActivityEntity(
    row.id as string,
    row.ticket_id as string,
    row.action as string,
    (row.changes as Record<string, { from: unknown; to: unknown }>) ?? {},
    (row.actor_type as 'user' | 'agent') ?? 'user',
    (row.actor_name as string) ?? null,
    (row.source as 'web' | 'api') ?? 'web',
    new Date(row.created_at as string),
  );
}
