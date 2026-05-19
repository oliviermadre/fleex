import type { TicketStatus, TicketPriority, TicketType, TicketLinkType, TicketLink, GitHubIssueMetadata } from '@fleex/shared';
import { BoardEntity } from '../../../domain/entities/board.entity.js';
import { TicketEntity } from '../../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../../domain/entities/ticket-activity.entity.js';
import type { TicketStorePort } from '../../../application/ports/ticket-store.port.js';
import type { SqliteConnection } from './connection.js';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
const MAX_ACTIVITY_ENTRIES = 5000;

interface BoardRow {
  id: string;
  name: string;
  emoji: string;
  created_at: string;
  updated_at: string;
}

interface TicketRow {
  id: string;
  board_id: string;
  display_id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  type: string | null;
  position: number;
  tags: string;
  links: string;
  blocked: number;
  favorite: number;
  due_date: string | null;
  assignee: string | null;
  agent_claimed_at: string | null;
  github_metadata: string | null;
  archived_at: string | null;
  first_doing_at: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
}

interface ActivityRow {
  id: string;
  ticket_id: string;
  action: string;
  changes: string;
  actor_type: string;
  actor_name: string | null;
  source: string;
  created_at: string;
}

export class SqliteTicketStoreAdapter implements TicketStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  // ── Boards ──

  async getAllBoards(): Promise<BoardEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM boards').all() as BoardRow[];
    return rows.map((r) => this.toBoardEntity(r));
  }

  async getBoardById(id: string): Promise<BoardEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as BoardRow | undefined;
    return row ? this.toBoardEntity(row) : null;
  }

  async saveBoard(board: BoardEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO boards
        (id, name, emoji, created_at, updated_at)
      VALUES
        (@id, @name, @emoji, @created_at, @updated_at)
    `);

    stmt.run({
      id: board.id,
      name: board.name,
      emoji: board.emoji,
      created_at: board.createdAt.toISOString(),
      updated_at: board.updatedAt.toISOString(),
    });
  }

  async removeBoard(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  }

  // ── Tickets ──

  async createTicket(ticket: TicketEntity): Promise<void> {
    // Atomic: MAX+1 sub-query is evaluated within the INSERT.
    // Safe in this app: single process, WAL mode, UNIQUE index on display_id
    // would surface any race as an error rather than producing a duplicate.
    const stmt = this.conn.db.prepare(`
      INSERT INTO tickets
        (id, board_id, display_id, title, description, status, priority, type, position,
         tags, links, blocked, favorite, due_date, assignee, agent_claimed_at,
         github_metadata, archived_at, first_doing_at, status_changed_at, created_at, updated_at)
      VALUES
        (@id, @board_id,
         (SELECT COALESCE(MAX(display_id), 0) + 1 FROM tickets),
         @title, @description, @status, @priority, @type, @position,
         @tags, @links, @blocked, @favorite, @due_date, @assignee, @agent_claimed_at,
         @github_metadata, @archived_at, @first_doing_at, @status_changed_at, @created_at, @updated_at)
      RETURNING display_id
    `);

    const row = stmt.get({
      id: ticket.id,
      board_id: ticket.boardId,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      type: ticket.type,
      position: ticket.position,
      tags: JSON.stringify(ticket.tags),
      links: JSON.stringify(ticket.links),
      blocked: ticket.blocked ? 1 : 0,
      favorite: ticket.favorite ? 1 : 0,
      due_date: ticket.dueDate?.toISOString() ?? null,
      assignee: ticket.assignee,
      agent_claimed_at: ticket.agentClaimedAt?.toISOString() ?? null,
      github_metadata: ticket.githubMetadata ? JSON.stringify(ticket.githubMetadata) : null,
      archived_at: ticket.archivedAt?.toISOString() ?? null,
      first_doing_at: ticket.firstDoingAt?.toISOString() ?? null,
      status_changed_at: ticket.statusChangedAt.toISOString(),
      created_at: ticket.createdAt.toISOString(),
      updated_at: ticket.updatedAt.toISOString(),
    }) as { display_id: number } | undefined;

    if (!row) throw new Error('createTicket failed to return display_id');
    ticket.displayId = row.display_id;
  }


  async getAllTickets(): Promise<TicketEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM tickets WHERE archived_at IS NULL').all() as TicketRow[];
    return rows.map((r) => this.toTicketEntity(r));
  }

  async getTicketById(id: string): Promise<TicketEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
    return row ? this.toTicketEntity(row) : null;
  }

  async getTicketsByBoard(boardId: string): Promise<TicketEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM tickets WHERE board_id = ? AND archived_at IS NULL ORDER BY position ASC')
      .all(boardId) as TicketRow[];
    return rows.map((r) => this.toTicketEntity(r));
  }

  async getTicketsByStatus(boardId: string, status: TicketStatus): Promise<TicketEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM tickets WHERE board_id = ? AND status = ? AND archived_at IS NULL ORDER BY position ASC')
      .all(boardId, status) as TicketRow[];
    return rows.map((r) => this.toTicketEntity(r));
  }

  async getTicketsLinkedTo(type: TicketLinkType, ref: string): Promise<TicketEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM tickets').all() as TicketRow[];
    return rows
      .map((r) => this.toTicketEntity(r))
      .filter((t) => t.links.some((l) => l.type === type && l.ref === ref));
  }

  async saveTicket(ticket: TicketEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO tickets
        (id, board_id, display_id, title, description, status, priority, type, position,
         tags, links, blocked, favorite, due_date, assignee, agent_claimed_at,
         github_metadata, archived_at, first_doing_at, status_changed_at, created_at, updated_at)
      VALUES
        (@id, @board_id, @display_id, @title, @description, @status, @priority, @type, @position,
         @tags, @links, @blocked, @favorite, @due_date, @assignee, @agent_claimed_at,
         @github_metadata, @archived_at, @first_doing_at, @status_changed_at, @created_at, @updated_at)
    `);

    stmt.run({
      id: ticket.id,
      board_id: ticket.boardId,
      display_id: ticket.displayId,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      type: ticket.type,
      position: ticket.position,
      tags: JSON.stringify(ticket.tags),
      links: JSON.stringify(ticket.links),
      blocked: ticket.blocked ? 1 : 0,
      favorite: ticket.favorite ? 1 : 0,
      due_date: ticket.dueDate?.toISOString() ?? null,
      assignee: ticket.assignee,
      agent_claimed_at: ticket.agentClaimedAt?.toISOString() ?? null,
      github_metadata: ticket.githubMetadata ? JSON.stringify(ticket.githubMetadata) : null,
      archived_at: ticket.archivedAt?.toISOString() ?? null,
      first_doing_at: ticket.firstDoingAt?.toISOString() ?? null,
      status_changed_at: ticket.statusChangedAt.toISOString(),
      created_at: ticket.createdAt.toISOString(),
      updated_at: ticket.updatedAt.toISOString(),
    });
  }

  async removeTicket(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
  }

  async removeTicketsByBoard(boardId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM tickets WHERE board_id = ?').run(boardId);
  }

  // ── Agent queries ──

  async getNextTicketForAgent(boardId?: string): Promise<TicketEntity | null> {
    let rows: TicketRow[];

    if (boardId) {
      rows = this.conn.db
        .prepare('SELECT * FROM tickets WHERE status = ? AND blocked = 0 AND archived_at IS NULL AND board_id = ?')
        .all('todo', boardId) as TicketRow[];
    } else {
      rows = this.conn.db
        .prepare('SELECT * FROM tickets WHERE status = ? AND blocked = 0 AND archived_at IS NULL')
        .all('todo') as TicketRow[];
    }

    const candidates = rows.map((r) => this.toTicketEntity(r));

    candidates.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 3;
      const pb = PRIORITY_ORDER[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return a.position - b.position;
    });

    return candidates[0] ?? null;
  }

  async getClaimedByAgent(agentName: string): Promise<TicketEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM tickets WHERE status = ? AND assignee = ? AND archived_at IS NULL')
      .all('doing', agentName) as TicketRow[];
    return rows.map((r) => this.toTicketEntity(r));
  }

  // ── Archive ──

  async getArchivedTickets(boardId?: string, limit = 50, offset = 0): Promise<TicketEntity[]> {
    let rows: TicketRow[];
    if (boardId) {
      rows = this.conn.db
        .prepare('SELECT * FROM tickets WHERE archived_at IS NOT NULL AND board_id = ? ORDER BY archived_at DESC LIMIT ? OFFSET ?')
        .all(boardId, limit, offset) as TicketRow[];
    } else {
      rows = this.conn.db
        .prepare('SELECT * FROM tickets WHERE archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as TicketRow[];
    }
    return rows.map((r) => this.toTicketEntity(r));
  }

  async countArchivedTickets(boardId?: string): Promise<number> {
    let row: { cnt: number };
    if (boardId) {
      row = this.conn.db
        .prepare('SELECT COUNT(*) as cnt FROM tickets WHERE archived_at IS NOT NULL AND board_id = ?')
        .get(boardId) as { cnt: number };
    } else {
      row = this.conn.db
        .prepare('SELECT COUNT(*) as cnt FROM tickets WHERE archived_at IS NOT NULL')
        .get() as { cnt: number };
    }
    return row.cnt;
  }

  // ── Activity ──

  async saveActivity(entry: TicketActivityEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO ticket_activities
        (id, ticket_id, action, changes, actor_type, actor_name, source, created_at)
      VALUES
        (@id, @ticket_id, @action, @changes, @actor_type, @actor_name, @source, @created_at)
    `);

    stmt.run({
      id: entry.id,
      ticket_id: entry.ticketId,
      action: entry.action,
      changes: JSON.stringify(entry.changes),
      actor_type: entry.actorType,
      actor_name: entry.actorName,
      source: entry.source,
      created_at: entry.createdAt.toISOString(),
    });

    // Cap total activities at MAX_ACTIVITY_ENTRIES
    const countRow = this.conn.db
      .prepare('SELECT COUNT(*) as cnt FROM ticket_activities')
      .get() as { cnt: number };

    if (countRow.cnt > MAX_ACTIVITY_ENTRIES) {
      this.conn.db.prepare(`
        DELETE FROM ticket_activities WHERE id IN (
          SELECT id FROM ticket_activities
          ORDER BY created_at ASC
          LIMIT ?
        )
      `).run(countRow.cnt - MAX_ACTIVITY_ENTRIES);
    }
  }

  async getActivitiesByTicket(ticketId: string, limit = 50): Promise<TicketActivityEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM ticket_activities WHERE ticket_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(ticketId, limit) as ActivityRow[];
    return rows.map((r) => this.toActivityEntity(r));
  }

  async searchTicketsByActivityFilters(options: {
    since?: Date;
    until?: Date;
    action?: string;
    limit?: number;
  }): Promise<TicketActivityEntity[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.since) {
      conditions.push('created_at >= ?');
      params.push(options.since.toISOString());
    }
    if (options.until) {
      conditions.push('created_at <= ?');
      params.push(options.until.toISOString());
    }
    if (options.action) {
      conditions.push('action = ?');
      params.push(options.action);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 200;
    params.push(limit);

    const rows = this.conn.db
      .prepare(`SELECT * FROM ticket_activities ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as ActivityRow[];
    return rows.map((r) => this.toActivityEntity(r));
  }

  // ── Row-to-Entity mappers ──

  private toBoardEntity(row: BoardRow): BoardEntity {
    return new BoardEntity(
      row.id,
      row.name,
      row.emoji,
      new Date(row.created_at),
      new Date(row.updated_at),
    );
  }

  private toTicketEntity(row: TicketRow): TicketEntity {
    return new TicketEntity(
      row.id,
      row.board_id,
      row.display_id ?? 0,
      row.title,
      row.description,
      row.status as TicketStatus,
      row.priority as TicketPriority,
      (row.type as TicketType | null) ?? null,
      row.position,
      JSON.parse(row.tags) as string[],
      JSON.parse(row.links) as TicketLink[],
      row.blocked === 1,
      row.favorite === 1,
      row.due_date ? new Date(row.due_date) : null,
      row.assignee,
      row.agent_claimed_at ? new Date(row.agent_claimed_at) : null,
      row.github_metadata ? (JSON.parse(row.github_metadata) as GitHubIssueMetadata) : null,
      row.archived_at ? new Date(row.archived_at) : null,
      row.first_doing_at ? new Date(row.first_doing_at) : null,
      new Date(row.status_changed_at),
      new Date(row.created_at),
      new Date(row.updated_at),
    );
  }

  private toActivityEntity(row: ActivityRow): TicketActivityEntity {
    return new TicketActivityEntity(
      row.id,
      row.ticket_id,
      row.action,
      JSON.parse(row.changes) as Record<string, { from: unknown; to: unknown }>,
      row.actor_type as 'user' | 'agent',
      row.actor_name,
      row.source as 'web' | 'api',
      new Date(row.created_at),
    );
  }
}
