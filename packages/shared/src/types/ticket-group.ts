// ── Ticket Groups (Epics) ──

export type TicketGroupTimeframe = 'now' | 'next' | 'later';
export type TicketGroupStatus = 'active' | 'done' | 'cancelled' | 'archived';

export interface TicketGroup {
  readonly id: string;
  readonly boardIds: string[];
  /** @deprecated Use boardIds */
  readonly boardId?: string;
  readonly name: string;
  readonly emoji: string;
  readonly color: string;
  readonly description: string;
  readonly timeframe: TicketGroupTimeframe;
  readonly groupStatus: TicketGroupStatus;
  readonly blocked: boolean;
  readonly favorite: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TicketGroupMembership {
  readonly ticketId: string;
  readonly groupId: string;
}

export interface TicketRelationship {
  readonly parentId: string;
  readonly childId: string;
}

export interface CreateTicketGroupRequest {
  readonly boardId?: string;
  readonly boardIds?: string[];
  readonly name: string;
  readonly emoji?: string;
  readonly color?: string;
  readonly description?: string;
  readonly timeframe?: TicketGroupTimeframe;
}

export interface UpdateTicketGroupRequest {
  readonly name?: string;
  readonly emoji?: string;
  readonly color?: string;
  readonly description?: string;
  readonly timeframe?: TicketGroupTimeframe;
  readonly groupStatus?: TicketGroupStatus;
  readonly blocked?: boolean;
  readonly favorite?: boolean;
}

export type TicketGroupWsMessageType =
  | 'ticketGroup:created'
  | 'ticketGroup:updated'
  | 'ticketGroup:deleted'
  | 'ticketGroup:memberAdded'
  | 'ticketGroup:memberRemoved'
  | 'ticketGroup:boardAdded'
  | 'ticketGroup:boardRemoved'
  | 'ticketRelationship:created'
  | 'ticketRelationship:deleted';

export interface TicketGroupWsMessage {
  readonly type: TicketGroupWsMessageType;
  readonly data: unknown;
}
