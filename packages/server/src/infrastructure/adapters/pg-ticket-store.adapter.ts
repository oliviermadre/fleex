import type { TicketStatus, TicketLinkType, TicketLink, TicketPriority, GitHubIssueMetadata } from '@asm/shared';
import { BoardEntity } from '../../domain/entities/board.entity.js';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketStorePort } from '../../application/ports/ticket-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { DbPool } from '../database/db.js';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };

interface BoardRow {
  id: string;
  user_id: string;
  data: {
    name: string;
    emoji: string;
    repositoryOrg: string | null;
    repositoryName: string | null;
  };
  created_at: string;
  updated_at: string;
}

interface TicketRow {
  id: string;
  user_id: string;
  board_id: string;
  status: TicketStatus;
  data: {
    title: string;
    description: string;
    priority: TicketPriority;
    position: number;
    tags: string[];
    links: TicketLink[];
    blocked: boolean;
    favorite: boolean;
    dueDate: string | null;
    assignee: string | null;
    agentClaimedAt: string | null;
    githubMetadata: GitHubIssueMetadata | null;
    statusChangedAt: string;
  };
  created_at: string;
  updated_at: string;
}

interface ActivityRow {
  id: string;
  user_id: string;
  ticket_id: string;
  data: {
    action: string;
    changes: Record<string, { from: unknown; to: unknown }>;
    actorType: 'user' | 'agent';
    actorName: string | null;
    source: 'web' | 'api';
  };
  created_at: string;
}

export class PgTicketStore implements TicketStorePort {
  private readonly boards = new Map<string, BoardEntity>();
  private readonly tickets = new Map<string, TicketEntity>();
  private readonly activities: TicketActivityEntity[] = [];

  constructor(
    private readonly pool: DbPool,
    private readonly userId: string,
    private readonly logger: LoggerPort,
  ) {}

  async init(): Promise<void> {
    // Load boards
    const { rows: boardRows } = (await this.pool.query(
      'SELECT * FROM boards WHERE user_id = $1',
      [this.userId],
    )) as { rows: BoardRow[] };
    for (const row of boardRows) {
      this.boards.set(row.id, this.boardRowToEntity(row));
    }

    // Load tickets
    const { rows: ticketRows } = (await this.pool.query(
      'SELECT * FROM tickets WHERE user_id = $1',
      [this.userId],
    )) as { rows: TicketRow[] };
    for (const row of ticketRows) {
      this.tickets.set(row.id, this.ticketRowToEntity(row));
    }

    // Load recent activity
    const { rows: activityRows } = (await this.pool.query(
      'SELECT * FROM ticket_activity WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5000',
      [this.userId],
    )) as { rows: ActivityRow[] };
    for (const row of activityRows) {
      this.activities.push(this.activityRowToEntity(row));
    }

    this.logger.info('PgTicketStore loaded', {
      boards: this.boards.size,
      tickets: this.tickets.size,
      activities: this.activities.length,
    });
  }

  // ── Boards ──

  async getAllBoards(): Promise<BoardEntity[]> {
    return Array.from(this.boards.values());
  }

  async getBoardById(id: string): Promise<BoardEntity | null> {
    return this.boards.get(id) ?? null;
  }

  async saveBoard(board: BoardEntity): Promise<void> {
    const data = {
      name: board.name,
      emoji: board.emoji,
      repositoryOrg: board.repositoryOrg,
      repositoryName: board.repositoryName,
    };
    await this.pool.query(
      `INSERT INTO boards (id, user_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET data = $3, updated_at = $5`,
      [board.id, this.userId, JSON.stringify(data),
       board.createdAt.toISOString(), board.updatedAt.toISOString()],
    );
    this.boards.set(board.id, board);
  }

  async removeBoard(id: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM boards WHERE id = $1 AND user_id = $2',
      [id, this.userId],
    );
    this.boards.delete(id);
  }

  // ── Tickets ──

  async getAllTickets(): Promise<TicketEntity[]> {
    return Array.from(this.tickets.values());
  }

  async getTicketById(id: string): Promise<TicketEntity | null> {
    return this.tickets.get(id) ?? null;
  }

  async getTicketsByBoard(boardId: string): Promise<TicketEntity[]> {
    const all = await this.getAllTickets();
    return all
      .filter((t) => t.boardId === boardId)
      .sort((a, b) => a.position - b.position);
  }

  async getTicketsByStatus(boardId: string, status: TicketStatus): Promise<TicketEntity[]> {
    const boardTickets = await this.getTicketsByBoard(boardId);
    return boardTickets.filter((t) => t.status === status);
  }

  async getTicketsLinkedTo(type: TicketLinkType, ref: string): Promise<TicketEntity[]> {
    const all = await this.getAllTickets();
    return all.filter((t) =>
      t.links.some((l) => l.type === type && l.ref === ref),
    );
  }

  async saveTicket(ticket: TicketEntity): Promise<void> {
    const data = {
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      position: ticket.position,
      tags: ticket.tags,
      links: ticket.links,
      blocked: ticket.blocked,
      favorite: ticket.favorite,
      dueDate: ticket.dueDate?.toISOString() ?? null,
      assignee: ticket.assignee,
      agentClaimedAt: ticket.agentClaimedAt?.toISOString() ?? null,
      githubMetadata: ticket.githubMetadata,
      statusChangedAt: ticket.statusChangedAt.toISOString(),
    };
    await this.pool.query(
      `INSERT INTO tickets (id, user_id, board_id, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET board_id = $3, status = $4, data = $5, updated_at = $7`,
      [ticket.id, this.userId, ticket.boardId, ticket.status,
       JSON.stringify(data), ticket.createdAt.toISOString(), ticket.updatedAt.toISOString()],
    );
    this.tickets.set(ticket.id, ticket);
  }

  async removeTicket(id: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM tickets WHERE id = $1 AND user_id = $2',
      [id, this.userId],
    );
    this.tickets.delete(id);
  }

  async removeTicketsByBoard(boardId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM tickets WHERE board_id = $1 AND user_id = $2',
      [boardId, this.userId],
    );
    for (const [id, t] of this.tickets) {
      if (t.boardId === boardId) this.tickets.delete(id);
    }
  }

  // ── Agent queries ──

  async getNextTicketForAgent(boardId?: string): Promise<TicketEntity | null> {
    const all = await this.getAllTickets();
    let candidates = all.filter(
      (t) => t.status === 'todo' && !t.blocked,
    );
    if (boardId) {
      candidates = candidates.filter((t) => t.boardId === boardId);
    }
    candidates.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 3;
      const pb = PRIORITY_ORDER[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return a.position - b.position;
    });
    return candidates[0] ?? null;
  }

  async getClaimedByAgent(agentName: string): Promise<TicketEntity[]> {
    const all = await this.getAllTickets();
    return all.filter(
      (t) => t.assignee === agentName && t.status === 'doing',
    );
  }

  // ── Activity ──

  async saveActivity(entry: TicketActivityEntity): Promise<void> {
    const data = {
      action: entry.action,
      changes: entry.changes,
      actorType: entry.actorType,
      actorName: entry.actorName,
      source: entry.source,
    };
    await this.pool.query(
      `INSERT INTO ticket_activity (id, user_id, ticket_id, data, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.id, this.userId, entry.ticketId, JSON.stringify(data),
       entry.createdAt.toISOString()],
    );
    this.activities.push(entry);
  }

  async getActivitiesByTicket(ticketId: string, limit = 50): Promise<TicketActivityEntity[]> {
    return this.activities
      .filter((a) => a.ticketId === ticketId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  // ── Row mapping ──

  private boardRowToEntity(row: BoardRow): BoardEntity {
    const d = row.data;
    return new BoardEntity(
      row.id, d.name, d.emoji,
      d.repositoryOrg, d.repositoryName,
      new Date(row.created_at), new Date(row.updated_at),
    );
  }

  private ticketRowToEntity(row: TicketRow): TicketEntity {
    const d = row.data;
    return new TicketEntity(
      row.id, row.board_id, d.title, d.description,
      row.status as TicketStatus, d.priority as TicketPriority,
      d.position, d.tags, d.links, d.blocked, d.favorite ?? false,
      d.dueDate ? new Date(d.dueDate) : null,
      d.assignee,
      d.agentClaimedAt ? new Date(d.agentClaimedAt) : null,
      d.githubMetadata ?? null,
      new Date(d.statusChangedAt),
      new Date(row.created_at), new Date(row.updated_at),
    );
  }

  private activityRowToEntity(row: ActivityRow): TicketActivityEntity {
    const d = row.data;
    return new TicketActivityEntity(
      row.id, row.ticket_id, d.action, d.changes,
      d.actorType, d.actorName, d.source,
      new Date(row.created_at),
    );
  }
}
