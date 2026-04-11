import type { TicketGroupTimeframe, TicketGroupStatus, TicketGroupMembership, TicketRelationship } from '@fleex/shared';
import { TicketGroupEntity } from '../../../domain/entities/ticket-group.entity.js';
import type { TicketGroupStorePort } from '../../../application/ports/ticket-group-store.port.js';
import type { PgConnection } from './connection.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntity(row: any): TicketGroupEntity {
  return new TicketGroupEntity(
    row.id,
    row.board_id,
    row.name,
    row.emoji,
    row.color,
    row.description,
    row.timeframe as TicketGroupTimeframe,
    row.group_status as TicketGroupStatus,
    Boolean(row.blocked),
    Boolean(row.favorite),
    new Date(row.created_at),
    new Date(row.updated_at),
  );
}

export class PgTicketGroupStore implements TicketGroupStorePort {
  constructor(private readonly db: PgConnection) {}

  // ── Ticket Groups ──

  async getAllTicketGroups(): Promise<TicketGroupEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM ticket_groups');
    return rows.map(rowToEntity);
  }

  async getTicketGroupById(id: string): Promise<TicketGroupEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM ticket_groups WHERE id = $1', [id]);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async getTicketGroupsByBoard(boardId: string): Promise<TicketGroupEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM ticket_groups WHERE board_id = $1', [boardId]);
    return rows.map(rowToEntity);
  }

  async saveTicketGroup(group: TicketGroupEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO ticket_groups (id, board_id, name, emoji, color, description, timeframe, group_status, blocked, favorite, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         board_id = $2, name = $3, emoji = $4, color = $5, description = $6,
         timeframe = $7, group_status = $8, blocked = $9, favorite = $10,
         created_at = $11, updated_at = $12`,
      [
        group.id, group.boardId, group.name, group.emoji, group.color,
        group.description, group.timeframe, group.groupStatus,
        group.blocked, group.favorite,
        group.createdAt.toISOString(), group.updatedAt.toISOString(),
      ],
    );
  }

  async removeTicketGroup(id: string): Promise<void> {
    await this.db.query('DELETE FROM ticket_groups WHERE id = $1', [id]);
  }

  // ── Memberships ──

  async getMembershipsByGroup(groupId: string): Promise<TicketGroupMembership[]> {
    const { rows } = await this.db.query('SELECT * FROM ticket_group_memberships WHERE group_id = $1', [groupId]);
    return rows.map((r: { ticket_id: string; group_id: string }) => ({ ticketId: r.ticket_id, groupId: r.group_id }));
  }

  async getMembershipsByTicket(ticketId: string): Promise<TicketGroupMembership[]> {
    const { rows } = await this.db.query('SELECT * FROM ticket_group_memberships WHERE ticket_id = $1', [ticketId]);
    return rows.map((r: { ticket_id: string; group_id: string }) => ({ ticketId: r.ticket_id, groupId: r.group_id }));
  }

  async addMembership(ticketId: string, groupId: string): Promise<void> {
    await this.db.query(
      'INSERT INTO ticket_group_memberships (ticket_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [ticketId, groupId],
    );
  }

  async removeMembership(ticketId: string, groupId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM ticket_group_memberships WHERE ticket_id = $1 AND group_id = $2',
      [ticketId, groupId],
    );
  }

  async removeMembershipsByGroup(groupId: string): Promise<void> {
    await this.db.query('DELETE FROM ticket_group_memberships WHERE group_id = $1', [groupId]);
  }

  async removeMembershipsByTicket(ticketId: string): Promise<void> {
    await this.db.query('DELETE FROM ticket_group_memberships WHERE ticket_id = $1', [ticketId]);
  }

  // ── Relationships ──

  async getChildRelationships(parentId: string): Promise<TicketRelationship[]> {
    const { rows } = await this.db.query('SELECT * FROM ticket_relationships WHERE parent_id = $1', [parentId]);
    return rows.map((r: { parent_id: string; child_id: string }) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async getParentRelationships(childId: string): Promise<TicketRelationship[]> {
    const { rows } = await this.db.query('SELECT * FROM ticket_relationships WHERE child_id = $1', [childId]);
    return rows.map((r: { parent_id: string; child_id: string }) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async addRelationship(parentId: string, childId: string): Promise<void> {
    await this.db.query(
      'INSERT INTO ticket_relationships (parent_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [parentId, childId],
    );
  }

  async removeRelationship(parentId: string, childId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM ticket_relationships WHERE parent_id = $1 AND child_id = $2',
      [parentId, childId],
    );
  }

  async removeRelationshipsByTicket(ticketId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM ticket_relationships WHERE parent_id = $1 OR child_id = $1',
      [ticketId],
    );
  }
}
