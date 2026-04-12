import type { TicketGroupTimeframe, TicketGroupStatus, TicketGroupMembership, TicketRelationship } from '@fleex/shared';
import { TicketGroupEntity } from '../../../domain/entities/ticket-group.entity.js';
import type { TicketGroupStorePort } from '../../../application/ports/ticket-group-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface TicketGroupRow {
  id: string; board_id: string | null; name: string; emoji: string; color: string;
  description: string; timeframe: string; group_status: string;
  blocked: boolean; favorite: boolean; created_at: string; updated_at: string;
}
interface MembershipRow { ticket_id: string; group_id: string }
interface RelationshipRow { parent_id: string; child_id: string }
interface BoardAssocRow { group_id: string; board_id: string }

function rowToEntity(r: TicketGroupRow, boardIds: string[]): TicketGroupEntity {
  return new TicketGroupEntity(
    r.id, boardIds, r.name, r.emoji, r.color, r.description,
    r.timeframe as TicketGroupTimeframe, r.group_status as TicketGroupStatus,
    r.blocked, r.favorite, new Date(r.created_at), new Date(r.updated_at),
  );
}

export class SupabaseTicketGroupStore implements TicketGroupStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  // ── Ticket Groups ──

  async getAllTicketGroups(): Promise<TicketGroupEntity[]> {
    const { data, error } = await this.conn.client.from('ticket_groups').select('*');
    if (error) throw new Error(`Failed to fetch ticket groups: ${error.message}`);
    const { data: assocData } = await this.conn.client.from('ticket_group_boards').select('*');
    const boardMap = new Map<string, string[]>();
    for (const a of (assocData ?? []) as BoardAssocRow[]) {
      if (!boardMap.has(a.group_id)) boardMap.set(a.group_id, []);
      boardMap.get(a.group_id)!.push(a.board_id);
    }
    return (data as TicketGroupRow[]).map((r) => rowToEntity(r, boardMap.get(r.id) ?? (r.board_id ? [r.board_id] : [])));
  }

  async getTicketGroupById(id: string): Promise<TicketGroupEntity | null> {
    const { data, error } = await this.conn.client.from('ticket_groups').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Failed to fetch ticket group: ${error.message}`);
    if (!data) return null;
    const { data: assocData } = await this.conn.client.from('ticket_group_boards').select('board_id').eq('group_id', id);
    const boardIds = ((assocData ?? []) as BoardAssocRow[]).map((a) => a.board_id);
    return rowToEntity(data as TicketGroupRow, boardIds.length > 0 ? boardIds : (data.board_id ? [data.board_id] : []));
  }

  async getTicketGroupsByBoard(boardId: string): Promise<TicketGroupEntity[]> {
    // Get group IDs from junction, then fetch groups
    const { data: assocData, error: assocErr } = await this.conn.client.from('ticket_group_boards').select('group_id').eq('board_id', boardId);
    if (assocErr) throw new Error(`Failed to fetch board associations: ${assocErr.message}`);
    const groupIds = ((assocData ?? []) as { group_id: string }[]).map((a) => a.group_id);
    if (groupIds.length === 0) return [];
    const { data, error } = await this.conn.client.from('ticket_groups').select('*').in('id', groupIds);
    if (error) throw new Error(`Failed to fetch ticket groups: ${error.message}`);
    // Fetch all board associations for these groups
    const { data: allAssocData } = await this.conn.client.from('ticket_group_boards').select('*').in('group_id', groupIds);
    const boardMap = new Map<string, string[]>();
    for (const a of ((allAssocData ?? []) as BoardAssocRow[])) {
      if (!boardMap.has(a.group_id)) boardMap.set(a.group_id, []);
      boardMap.get(a.group_id)!.push(a.board_id);
    }
    return (data as TicketGroupRow[]).map((r) => rowToEntity(r, boardMap.get(r.id) ?? []));
  }

  async saveTicketGroup(group: TicketGroupEntity): Promise<void> {
    const { error } = await this.conn.client.from('ticket_groups').upsert({
      id: group.id, board_id: group.boardIds[0] ?? null,
      name: group.name, emoji: group.emoji, color: group.color, description: group.description,
      timeframe: group.timeframe, group_status: group.groupStatus,
      blocked: group.blocked, favorite: group.favorite,
      created_at: group.createdAt.toISOString(), updated_at: group.updatedAt.toISOString(),
    });
    if (error) throw new Error(`Failed to save ticket group: ${error.message}`);
    // Sync junction
    await this.conn.client.from('ticket_group_boards').delete().eq('group_id', group.id);
    if (group.boardIds.length > 0) {
      const { error: assocErr } = await this.conn.client.from('ticket_group_boards').upsert(
        group.boardIds.map((bid) => ({ group_id: group.id, board_id: bid })),
      );
      if (assocErr) throw new Error(`Failed to sync board associations: ${assocErr.message}`);
    }
  }

  async removeTicketGroup(id: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_groups').delete().eq('id', id);
    if (error) throw new Error(`Failed to delete ticket group: ${error.message}`);
  }

  // ── Board Associations ──

  async getBoardIdsByGroup(groupId: string): Promise<string[]> {
    const { data, error } = await this.conn.client.from('ticket_group_boards').select('board_id').eq('group_id', groupId);
    if (error) throw new Error(`Failed to fetch board IDs: ${error.message}`);
    return ((data ?? []) as BoardAssocRow[]).map((a) => a.board_id);
  }

  async addBoardToGroup(groupId: string, boardId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_group_boards').upsert(
      { group_id: groupId, board_id: boardId }, { onConflict: 'group_id,board_id' },
    );
    if (error) throw new Error(`Failed to add board: ${error.message}`);
  }

  async removeBoardFromGroup(groupId: string, boardId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_group_boards').delete().eq('group_id', groupId).eq('board_id', boardId);
    if (error) throw new Error(`Failed to remove board: ${error.message}`);
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
    const { error } = await this.conn.client.from('ticket_group_memberships').upsert({ ticket_id: ticketId, group_id: groupId }, { onConflict: 'ticket_id,group_id' });
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
    if (error) throw new Error(`Failed to fetch relationships: ${error.message}`);
    return (data as RelationshipRow[]).map((r) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async getParentRelationships(childId: string): Promise<TicketRelationship[]> {
    const { data, error } = await this.conn.client.from('ticket_relationships').select('*').eq('child_id', childId);
    if (error) throw new Error(`Failed to fetch relationships: ${error.message}`);
    return (data as RelationshipRow[]).map((r) => ({ parentId: r.parent_id, childId: r.child_id }));
  }

  async addRelationship(parentId: string, childId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_relationships').upsert({ parent_id: parentId, child_id: childId }, { onConflict: 'parent_id,child_id' });
    if (error) throw new Error(`Failed to add relationship: ${error.message}`);
  }

  async removeRelationship(parentId: string, childId: string): Promise<void> {
    const { error } = await this.conn.client.from('ticket_relationships').delete().eq('parent_id', parentId).eq('child_id', childId);
    if (error) throw new Error(`Failed to remove relationship: ${error.message}`);
  }

  async removeRelationshipsByTicket(ticketId: string): Promise<void> {
    const { error: e1 } = await this.conn.client.from('ticket_relationships').delete().eq('parent_id', ticketId);
    if (e1) throw new Error(`Failed to remove relationships: ${e1.message}`);
    const { error: e2 } = await this.conn.client.from('ticket_relationships').delete().eq('child_id', ticketId);
    if (e2) throw new Error(`Failed to remove relationships: ${e2.message}`);
  }
}
