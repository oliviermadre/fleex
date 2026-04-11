import type { TicketGroupTimeframe, TicketGroupStatus, TicketGroupMembership, TicketRelationship } from '@fleex/shared';
import { TicketGroupEntity } from '../../../domain/entities/ticket-group.entity.js';
import type { TicketGroupStorePort } from '../../../application/ports/ticket-group-store.port.js';
import type { SqliteConnection } from './connection.js';

interface TicketGroupRow {
  id: string;
  board_id: string;
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

interface MembershipRow {
  ticket_id: string;
  group_id: string;
}

interface RelationshipRow {
  parent_id: string;
  child_id: string;
}

export class SqliteTicketGroupStoreAdapter implements TicketGroupStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  // ── Ticket Groups ──

  async getAllTicketGroups(): Promise<TicketGroupEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM ticket_groups').all() as TicketGroupRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getTicketGroupById(id: string): Promise<TicketGroupEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM ticket_groups WHERE id = ?').get(id) as TicketGroupRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getTicketGroupsByBoard(boardId: string): Promise<TicketGroupEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM ticket_groups WHERE board_id = ?').all(boardId) as TicketGroupRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async saveTicketGroup(group: TicketGroupEntity): Promise<void> {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO ticket_groups
        (id, board_id, name, emoji, color, description, timeframe, group_status, blocked, favorite, created_at, updated_at)
      VALUES
        (@id, @board_id, @name, @emoji, @color, @description, @timeframe, @group_status, @blocked, @favorite, @created_at, @updated_at)
    `).run({
      id: group.id,
      board_id: group.boardId,
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
  }

  async removeTicketGroup(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_groups WHERE id = ?').run(id);
  }

  // ── Memberships ──

  async getMembershipsByGroup(groupId: string): Promise<TicketGroupMembership[]> {
    const rows = this.conn.db.prepare('SELECT * FROM ticket_group_memberships WHERE group_id = ?').all(groupId) as MembershipRow[];
    return rows.map((r) => ({ ticketId: r.ticket_id, groupId: r.group_id }));
  }

  async getMembershipsByTicket(ticketId: string): Promise<TicketGroupMembership[]> {
    const rows = this.conn.db.prepare('SELECT * FROM ticket_group_memberships WHERE ticket_id = ?').all(ticketId) as MembershipRow[];
    return rows.map((r) => ({ ticketId: r.ticket_id, groupId: r.group_id }));
  }

  async addMembership(ticketId: string, groupId: string): Promise<void> {
    this.conn.db.prepare(
      'INSERT OR IGNORE INTO ticket_group_memberships (ticket_id, group_id) VALUES (?, ?)',
    ).run(ticketId, groupId);
  }

  async removeMembership(ticketId: string, groupId: string): Promise<void> {
    this.conn.db.prepare(
      'DELETE FROM ticket_group_memberships WHERE ticket_id = ? AND group_id = ?',
    ).run(ticketId, groupId);
  }

  async removeMembershipsByGroup(groupId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_group_memberships WHERE group_id = ?').run(groupId);
  }

  async removeMembershipsByTicket(ticketId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM ticket_group_memberships WHERE ticket_id = ?').run(ticketId);
  }

  // ── Relationships ──

  async getChildRelationships(parentId: string): Promise<TicketRelationship[]> {
    const rows = this.conn.db.prepare('SELECT * FROM ticket_relationships WHERE parent_id = ?').all(parentId) as RelationshipRow[];
    return rows.map((r) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async getParentRelationships(childId: string): Promise<TicketRelationship[]> {
    const rows = this.conn.db.prepare('SELECT * FROM ticket_relationships WHERE child_id = ?').all(childId) as RelationshipRow[];
    return rows.map((r) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async addRelationship(parentId: string, childId: string): Promise<void> {
    this.conn.db.prepare(
      'INSERT OR IGNORE INTO ticket_relationships (parent_id, child_id) VALUES (?, ?)',
    ).run(parentId, childId);
  }

  async removeRelationship(parentId: string, childId: string): Promise<void> {
    this.conn.db.prepare(
      'DELETE FROM ticket_relationships WHERE parent_id = ? AND child_id = ?',
    ).run(parentId, childId);
  }

  async removeRelationshipsByTicket(ticketId: string): Promise<void> {
    this.conn.db.prepare(
      'DELETE FROM ticket_relationships WHERE parent_id = ? OR child_id = ?',
    ).run(ticketId, ticketId);
  }

  // ── Helpers ──

  private toEntity(row: TicketGroupRow): TicketGroupEntity {
    return new TicketGroupEntity(
      row.id,
      row.board_id,
      row.name,
      row.emoji,
      row.color,
      row.description,
      row.timeframe as TicketGroupTimeframe,
      row.group_status as TicketGroupStatus,
      row.blocked === 1,
      row.favorite === 1,
      new Date(row.created_at),
      new Date(row.updated_at),
    );
  }
}
