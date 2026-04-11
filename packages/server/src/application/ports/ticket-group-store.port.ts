import type { TicketGroupEntity } from '../../domain/entities/ticket-group.entity.js';
import type { TicketGroupMembership, TicketRelationship } from '@fleex/shared';

export interface TicketGroupStorePort {
  // ── Ticket Groups (Epics) ──
  getAllTicketGroups(): Promise<TicketGroupEntity[]>;
  getTicketGroupById(id: string): Promise<TicketGroupEntity | null>;
  getTicketGroupsByBoard(boardId: string): Promise<TicketGroupEntity[]>;
  saveTicketGroup(group: TicketGroupEntity): Promise<void>;
  removeTicketGroup(id: string): Promise<void>;

  // ── Memberships (Ticket ↔ Epic) ──
  getMembershipsByGroup(groupId: string): Promise<TicketGroupMembership[]>;
  getMembershipsByTicket(ticketId: string): Promise<TicketGroupMembership[]>;
  addMembership(ticketId: string, groupId: string): Promise<void>;
  removeMembership(ticketId: string, groupId: string): Promise<void>;
  removeMembershipsByGroup(groupId: string): Promise<void>;
  removeMembershipsByTicket(ticketId: string): Promise<void>;

  // ── Ticket Relationships (Parent ↔ Child) ──
  getChildRelationships(parentId: string): Promise<TicketRelationship[]>;
  getParentRelationships(childId: string): Promise<TicketRelationship[]>;
  addRelationship(parentId: string, childId: string): Promise<void>;
  removeRelationship(parentId: string, childId: string): Promise<void>;
  removeRelationshipsByTicket(ticketId: string): Promise<void>;
}
