import type { MentionTargetType } from '@fleex/shared';

// ── Base ──

export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

// ── Ticket events ──

export interface TicketCreatedEvent extends DomainEvent {
  type: 'ticket.created';
  ticketId: string;
  boardId: string;
}

export interface TicketUpdatedEvent extends DomainEvent {
  type: 'ticket.updated';
  ticketId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface TicketMovedEvent extends DomainEvent {
  type: 'ticket.moved';
  ticketId: string;
  fromStatus: string;
  toStatus: string;
}

export interface TicketDeletedEvent extends DomainEvent {
  type: 'ticket.deleted';
  ticketId: string;
}

// ── Board events ──

export interface BoardUpdatedEvent extends DomainEvent {
  type: 'board.updated';
  boardId: string;
}

export interface BoardDeletedEvent extends DomainEvent {
  type: 'board.deleted';
  boardId: string;
}

// ── Comment events ──

export interface CommentPostedEvent extends DomainEvent {
  type: 'comment.posted';
  commentId: string;
  ticketId: string;
  authorType: 'user' | 'agent';
  authorName: string;
  /** Mentions extracted from the comment */
  createdMentions: Array<{
    mentionId: string;
    targetAgent: string;
    targetType: MentionTargetType;
  }>;
}

export interface CommentUpdatedEvent extends DomainEvent {
  type: 'comment.updated';
  commentId: string;
  ticketId: string;
  /** Newly created mentions from the edit */
  createdMentions: Array<{
    mentionId: string;
    targetAgent: string;
    targetType: MentionTargetType;
  }>;
}

export interface CommentDeletedEvent extends DomainEvent {
  type: 'comment.deleted';
  commentId: string;
  ticketId: string;
}

// ── Mention events ──

export interface MentionCreatedEvent extends DomainEvent {
  type: 'mention.created';
  mentionId: string;
  ticketId: string;
  targetAgent: string;
  targetType: MentionTargetType;
  sourceAgent: string;
}

export interface MentionAcknowledgedEvent extends DomainEvent {
  type: 'mention.acknowledged';
  mentionId: string;
  ticketId: string;
  targetAgent: string;
}

export interface MentionResolvedEvent extends DomainEvent {
  type: 'mention.resolved';
  mentionId: string;
  ticketId: string;
  targetAgent: string;
  /** The agent that completed the work (may differ from targetAgent in manual resolution) */
  resolvedBy: string;
}

export interface MentionWaitingForInfoEvent extends DomainEvent {
  type: 'mention.waiting_for_info';
  mentionId: string;
  ticketId: string;
  targetAgent: string;
}

export interface MentionDeletedEvent extends DomainEvent {
  type: 'mention.deleted';
  mentionId: string;
  ticketId: string;
  commentId: string;
}

// ── Deliverable events ──

export interface DeliverableCreatedEvent extends DomainEvent {
  type: 'deliverable.created';
  deliverableId: string;
  ticketId: string;
  agentName: string;
  status: 'draft' | 'final';
}

export interface DeliverableUpdatedEvent extends DomainEvent {
  type: 'deliverable.updated';
  deliverableId: string;
  ticketId: string;
  agentName: string;
  oldStatus: string;
  newStatus: string;
}

// ── Persona events ──

export interface PersonaCreatedEvent extends DomainEvent {
  type: 'persona.created';
  personaId: string;
}

export interface PersonaUpdatedEvent extends DomainEvent {
  type: 'persona.updated';
  personaId: string;
}

export interface PersonaDeletedEvent extends DomainEvent {
  type: 'persona.deleted';
  personaId: string;
}

export interface PersonaExecutionStartedEvent extends DomainEvent {
  type: 'persona.execution_started';
  personaId: string;
  mentionIds: string[];
}

// ── Worktree events ──

export interface WorktreeCreatedEvent extends DomainEvent {
  type: 'worktree.created';
  repoPath: string;
  worktreePath: string;
  branch: string;
  isNewBranch: boolean;
}

// ── Session events ──

export interface SessionCreatedEvent extends DomainEvent {
  type: 'session.created';
  sessionId: string;
  sessionType: string;
  worktreeBranch: string | null;
}

export interface SessionRenamedEvent extends DomainEvent {
  type: 'session.renamed';
  sessionId: string;
  displayName: string;
}

export interface SessionKilledEvent extends DomainEvent {
  type: 'session.killed';
  sessionId: string;
}

// ── Union type ──

export type AnyDomainEvent =
  | TicketCreatedEvent
  | TicketUpdatedEvent
  | TicketMovedEvent
  | TicketDeletedEvent
  | BoardUpdatedEvent
  | BoardDeletedEvent
  | CommentPostedEvent
  | CommentUpdatedEvent
  | CommentDeletedEvent
  | MentionCreatedEvent
  | MentionAcknowledgedEvent
  | MentionResolvedEvent
  | MentionWaitingForInfoEvent
  | MentionDeletedEvent
  | DeliverableCreatedEvent
  | DeliverableUpdatedEvent
  | PersonaCreatedEvent
  | PersonaUpdatedEvent
  | PersonaDeletedEvent
  | PersonaExecutionStartedEvent
  | WorktreeCreatedEvent
  | SessionCreatedEvent
  | SessionRenamedEvent
  | SessionKilledEvent;

// ── Event type string union ──

export type DomainEventType = AnyDomainEvent['type'];
