import type { TicketGroupTimeframe, TicketGroupStatus, TicketGroupMembership, TicketRelationship } from '@fleex/shared';
import { TicketGroupEntity } from '../../../domain/entities/ticket-group.entity.js';
import type { TicketGroupStorePort } from '../../../application/ports/ticket-group-store.port.js';
import type { SupabaseConnection } from './connection.js';

// ── Row interfaces ──

interface TicketGroupRow {
  id: string;
  board_id: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  timeframe: string;
  group_status: string;
  blocked: boolean;
  favorite: boolean;
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

function rowToEntity(r: TicketGroupRow): TicketGroupEntity {
  return new TicketGroupEntity(
    r.id,
    r.board_id,
    r.name,
    r.emoji,
    r.color,
    r.description,
    r.timeframe as TicketGroupTimeframe,
    r.group_status as TicketGroupStatus,
    r.blocked,
    r.favorite,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}

export class SupabaseTicketGroupStore implements TicketGroupStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  // ── Ticket Groups ──

  async getAllTicketGroups(): Promise<TicketGroupEntity[]> {
    const { data, error } = await this.conn.client.from('ticket_groups').select('*');
    if (error) throw new Error(`Failed to fetch ticket groups: ${error.message}`);
    return (data as TicketGroupRow[]).map(rowToEntity);
  }

  async getTicketGroupById(id: string): Promise<TicketGroupEntity | null> {
    const { data, error } = await this.conn.client.from('ticket_groups').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Failed to fetch ticket group: ${error.message}`);
    return data ? rowToEntity(data as TicketGroupRow) : null;
  }

  async getTicketGroupsByBoard(boardId: string): Promise<TicketGroupEntity[]> {
    const { data, error } = await this.conn.client.from('ticket_groups').select('*').eq('board_id', boardId);
    if (error) throw new Error(`Failed to fetch ticket groups by board: ${error.message}`);
    return (data as TicketGroupRow[]).map(rowToEntity);
  }

  async saveTicketGroup(group: TicketGroupEntity): Promise<void> {
    const { error } = await this.conn.client.from('ticket_groups').upsert({
      id: group.id,
      board_id: group.boardId,
      name: group.name,
      emoji: group.emoji,
      color: group.color,
      description: group.description,
      timeframe: group.timeframe,
      group_status: group.groupStatus,
      blocked: group.blocked,
      favorite: group.favorite,
      created_at: group.createdAt.toISOString(),
      updated_at: group.updatedAt.toISOString(),
    });
    if (error) throw new Error(`Failed to save ticket group: ${error.message}`);
  }

  async removeTicketGroup(id: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_groups').delete().eq('id', id);
    if (error) throw new Error(`Failed to delete ticket group: ${error.message}`);
  }

  // ── Memberships ──

  async getMembershipsByGroup(groupId: string): Promise<TicketGroupMembership[]> {
    const { data, error } = await this.conn.client.from('ticket_group_memberships').select('*').eq('group_id', groupId);
    if (error) throw new Error(`Failed to fetch memberships: ${error.message}`);
    return (data as MembershipRow[]).map((r) => ({ ticketId: r.ticket_id, groupId: r.group_id }));
  }

  async getMembershipsByTicket(ticketId: string): Promise<TicketGroupMembership[]> {
    const { data, error } = await this.conn.client.from('ticket_group_memberships').select('*').eq('ticket_id', ticketId);
    if (error) throw new Error(`Failed to fetch memberships: ${error.message}`);
    return (data as MembershipRow[]).map((r) => ({ ticketId: r.ticket_id, groupId: r.group_id }));
  }

  async addMembership(ticketId: string, groupId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_group_memberships').upsert(
      { ticket_id: ticketId, group_id: groupId },
      { onConflict: 'ticket_id,group_id' },
    );
    if (error) throw new Error(`Failed to add membership: ${error.message}`);
  }

  async removeMembership(ticketId: string, groupId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_group_memberships').delete().eq('ticket_id', ticketId).eq('group_id', groupId);
    if (error) throw new Error(`Failed to remove membership: ${error.message}`);
  }

  async removeMembershipsByGroup(groupId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_group_memberships').delete().eq('group_id', groupId);
    if (error) throw new Error(`Failed to remove memberships: ${error.message}`);
  }

  async removeMembershipsByTicket(ticketId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_group_memberships').delete().eq('ticket_id', ticketId);
    if (error) throw new Error(`Failed to remove memberships: ${error.message}`);
  }

  // ── Relationships ──

  async getChildRelationships(parentId: string): Promise<TicketRelationship[]> {
    const { data, error } = await this.conn.client.from('ticket_relationships').select('*').eq('parent_id', parentId);
    if (error) throw new Error(`Failed to fetch child relationships: ${error.message}`);
    return (data as RelationshipRow[]).map((r) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async getParentRelationships(childId: string): Promise<TicketRelationship[]> {
    const { data, error } = await this.conn.client.from('ticket_relationships').select('*').eq('child_id', childId);
    if (error) throw new Error(`Failed to fetch parent relationships: ${error.message}`);
    return (data as RelationshipRow[]).map((r) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async addRelationship(parentId: string, childId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_relationships').upsert(
      { parent_id: parentId, child_id: childId },
      { onConflict: 'parent_id,child_id' },
    );
    if (error) throw new Error(`Failed to add relationship: ${error.message}`);
  }

  async removeRelationship(parentId: string, childId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_relationships').delete().eq('parent_id', parentId).eq('child_id', childId);
    if (error) throw new Error(`Failed to remove relationship: ${error.message}`);
  }

  async removeRelationshipsByTicket(ticketId: string): Promise<void> {
    // Supabase doesn't support OR in delete, so run two queries
    const { error: e1 } = await this.conn.client.from('ticket_relationships').delete().eq('parent_id', ticketId);
    if (e1) throw new Error(`Failed to remove relationships: ${e1.message}`);
    const { error: e2 } = await this.conn.client.from('ticket_relationships').delete().eq('child_id', ticketId);
    if (e2) throw new Error(`Failed to remove relationships: ${e2.message}`);
  }
}
