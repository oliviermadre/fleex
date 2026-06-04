import type { TicketGroupTimeframe, TicketGroupStatus, TicketGroupMembership, TicketRelationship } from '@fleex/shared';
import { TicketGroupEntity } from '../../../domain/entities/ticket-group.entity.js';
import type { TicketGroupStorePort } from '../../../application/ports/ticket-group-store.port.js';
import type { SqliteConnection } from './connection.js';

interface TicketGroupRow {
  id: string;
  board_id: string | null;
  name: string;
  emoji: string;
  color: string;
  description: string;
  timeframe: string;
  group_status: string;
  blocked: number;
  favorite: number;
  created_at: string;
  updated_at: string;
}

interface MembershipRow { ticket_id: string; group_id: string }
interface RelationshipRow { parent_id: string; child_id: string }
interface BoardAssocRow { group_id: string; board_id: string }

export class SqliteTicketGroupStoreAdapter implements TicketGroupStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  // ── Ticket Groups ──

  async getAllTicketGroups(): Promise<TicketGroupEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM ticket_groups').all() as TicketGroupRow[];
    // Batch-fetch all board associations
    const allAssoc = this.conn.db.prepare('SELECT * FROM ticket_group_boards').all() as BoardAssocRow[];
    const boardMap = new Map<string, string[]>();
    for (const a of allAssoc) {
      if (!boardMap.has(a.group_id)) boardMap.set(a.group_id, []);
      boardMap.get(a.group_id)!.push(a.board_id);
    }
    return rows.map((r) => this.toEntity(r, boardMap.get(r.id) ?? (r.board_id ? [r.board_id] : [])));
  }

  async getTicketGroupById(id: string): Promise<TicketGroupEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM ticket_groups WHERE id = ?').get(id) as TicketGroupRow | undefined;
    if (!row) return null;
    const boardIds = (this.conn.db.prepare('SELECT board_id FROM ticket_group_boards WHERE group_id = ?').all(id) as BoardAssocRow[]).map((a) => a.board_id);
    return this.toEntity(row, boardIds.length > 0 ? boardIds : (row.board_id ? [row.board_id] : []));
  }

  async getTicketGroupsByBoard(boardId: string): Promise<TicketGroupEntity[]> {
    const rows = this.conn.db.prepare(
      'SELECT tg.* FROM ticket_groups tg INNER JOIN ticket_group_boards tgb ON tg.id = tgb.group_id WHERE tgb.board_id = ?',
    ).all(boardId) as TicketGroupRow[];
    // Fetch all board associations for these groups
    if (rows.length === 0) return [];
    const allAssoc = this.conn.db.prepare('SELECT * FROM ticket_group_boards').all() as BoardAssocRow[];
    const boardMap = new Map<string, string[]>();
    for (const a of allAssoc) {
      if (!boardMap.has(a.group_id)) boardMap.set(a.group_id, []);
      boardMap.get(a.group_id)!.push(a.board_id);
    }
    return rows.map((r) => this.toEntity(r, boardMap.get(r.id) ?? []));
  }

  async saveTicketGroup(group: TicketGroupEntity): Promise<void> {
    // Use INSERT … ON CONFLICT DO UPDATE to avoid triggering ON DELETE CASCADE on
    // ticket_group_memberships and ticket_group_boards, which both reference ticket_groups(id).
    // INSERT OR REPLACE would silently delete all memberships on every save.
    this.conn.db.prepare(`
      INSERT INTO ticket_groups
        (id, board_id, name, emoji, color, description, timeframe, group_status, blocked, favorite, created_at, updated_at)
      VALUES
        (@id, @board_id, @name, @emoji, @color, @description, @timeframe, @group_status, @blocked, @favorite, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        board_id = excluded.board_id,
        name = excluded.name,
        emoji = excluded.emoji,
        color = excluded.color,
        description = excluded.description,
        timeframe = excluded.timeframe,
        group_status = excluded.group_status,
        blocked = excluded.blocked,
        favorite = excluded.favorite,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run({
      id: group.id,
      board_id: group.boardIds[0] ?? null,
      name: group.name,
      emoji: group.emoji,
      color: group.color,
      description: group.description,
      timeframe: group.timeframe,
      group_status: group.groupStatus,
      blocked: group.blocked ? 1 : 0,
      favorite: group.favorite ? 1 : 0,
      created_at: group.createdAt.toISOString(),
      updated_at: group.updatedAt.toISOString(),
    });
    // Sync junction
    this.conn.db.prepare('DELETE FROM ticket_group_boards WHERE group_id = ?').run(group.id);
    const insertAssoc = this.conn.db.prepare('INSERT OR IGNORE INTO ticket_group_boards (group_id, board_id) VALUES (?, ?)');
    for (const bid of group.boardIds) insertAssoc.run(group.id, bid);
  }

  async removeTicketGroup(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_groups WHERE id = ?').run(id);
  }

  // ── Board Associations ──

  async getBoardIdsByGroup(groupId: string): Promise<string[]> {
    return (this.conn.db.prepare('SELECT board_id FROM ticket_group_boards WHERE group_id = ?').all(groupId) as BoardAssocRow[]).map((a) => a.board_id);
  }

  async addBoardToGroup(groupId: string, boardId: string): Promise<void> {
    this.conn.db.prepare('INSERT OR IGNORE INTO ticket_group_boards (group_id, board_id) VALUES (?, ?)').run(groupId, boardId);
  }

  async removeBoardFromGroup(groupId: string, boardId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_group_boards WHERE group_id = ? AND board_id = ?').run(groupId, boardId);
  }

  // ── Memberships ──

  async getMembershipsByGroup(groupId: string): Promise<TicketGroupMembership[]> {
    return (this.conn.db.prepare('SELECT * FROM ticket_group_memberships WHERE group_id = ?').all(groupId) as MembershipRow[]).map((r) => ({ ticketId: r.ticket_id, groupId: r.group_id }));
  }

  async getMembershipsByTicket(ticketId: string): Promise<TicketGroupMembership[]> {
    return (this.conn.db.prepare('SELECT * FROM ticket_group_memberships WHERE ticket_id = ?').all(ticketId) as MembershipRow[]).map((r) => ({ ticketId: r.ticket_id, groupId: r.group_id }));
  }

  async addMembership(ticketId: string, groupId: string): Promise<void> {
    this.conn.db.prepare('INSERT OR IGNORE INTO ticket_group_memberships (ticket_id, group_id) VALUES (?, ?)').run(ticketId, groupId);
  }

  async removeMembership(ticketId: string, groupId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_group_memberships WHERE ticket_id = ? AND group_id = ?').run(ticketId, groupId);
  }

  async removeMembershipsByGroup(groupId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_group_memberships WHERE group_id = ?').run(groupId);
  }

  async removeMembershipsByTicket(ticketId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_group_memberships WHERE ticket_id = ?').run(ticketId);
  }

  // ── Relationships ──

  async getChildRelationships(parentId: string): Promise<TicketRelationship[]> {
    return (this.conn.db.prepare('SELECT * FROM ticket_relationships WHERE parent_id = ?').all(parentId) as RelationshipRow[]).map((r) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async getParentRelationships(childId: string): Promise<TicketRelationship[]> {
    return (this.conn.db.prepare('SELECT * FROM ticket_relationships WHERE child_id = ?').all(childId) as RelationshipRow[]).map((r) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async addRelationship(parentId: string, childId: string): Promise<void> {
    this.conn.db.prepare('INSERT OR IGNORE INTO ticket_relationships (parent_id, child_id) VALUES (?, ?)').run(parentId, childId);
  }

  async removeRelationship(parentId: string, childId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_relationships WHERE parent_id = ? AND child_id = ?').run(parentId, childId);
  }

  async removeRelationshipsByTicket(ticketId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_relationships WHERE parent_id = ? OR child_id = ?').run(ticketId, ticketId);
  }

  // ── Helpers ──

  private toEntity(row: TicketGroupRow, boardIds: string[]): TicketGroupEntity {
    return new TicketGroupEntity(
      row.id, boardIds, row.name, row.emoji, row.color, row.description,
      row.timeframe as TicketGroupTimeframe, row.group_status as TicketGroupStatus,
      row.blocked === 1, row.favorite === 1,
      new Date(row.created_at), new Date(row.updated_at),
    );
  }
}
