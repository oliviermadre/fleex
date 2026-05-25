import type { MentionTargetType, MentionExecutionMode, HookResult } from '@fleex/shared';

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
  /** Execution mode selected by the user for this comment */
  executionMode?: MentionExecutionMode;
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

export interface MentionWokenUpEvent extends DomainEvent {
  type: 'mention.woken_up';
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

export interface DeliverableDeletedEvent extends DomainEvent {
  type: 'deliverable.deleted';
  deliverableId: string;
  ticketId: string;
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

// ── Skill events ──

export interface SkillCreatedEvent extends DomainEvent {
  type: 'skill.created';
  skillId: string;
}

export interface SkillUpdatedEvent extends DomainEvent {
  type: 'skill.updated';
  skillId: string;
}

export interface SkillDeletedEvent extends DomainEvent {
  type: 'skill.deleted';
  skillId: string;
}

export interface SkillExecutedEvent extends DomainEvent {
  type: 'skill.executed';
  skillId: string;
  personaId: string;
  ticketId: string;
}

// ── Panel events ──

export interface PanelCreatedEvent extends DomainEvent {
  type: 'panel.created';
  panelId: string;
}

export interface PanelUpdatedEvent extends DomainEvent {
  type: 'panel.updated';
  panelId: string;
}

export interface PanelDeletedEvent extends DomainEvent {
  type: 'panel.deleted';
  panelId: string;
}

export interface PanelExecutedEvent extends DomainEvent {
  type: 'panel.executed';
  panelId: string;
  panelName: string;
  panelDisplayName: string;
  ticketId: string;
  status: 'completed' | 'failed';
  durationMs: number;
  memberCount: number;
  respondedMembers: number;
  failedMembers: number;
}

// ── Worktree events ──

export interface WorktreeCreatedEvent extends DomainEvent {
  type: 'worktree.created';
  repoPath: string;
  worktreePath: string;
  branch: string;
  isNewBranch: boolean;
  hookResult?: HookResult;
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

export interface SessionHookStatusChangedEvent extends DomainEvent {
  type: 'session.hookStatusChanged';
  sessionId: string;
  previousStatus: string;
  nextStatus: string;
  waitingReason: string | null;
}

// ── Ticket Group events ──

export interface TicketGroupCreatedEvent extends DomainEvent {
  type: 'ticketGroup.created';
  groupId: string;
  boardId: string;
}

export interface TicketGroupUpdatedEvent extends DomainEvent {
  type: 'ticketGroup.updated';
  groupId: string;
  changes: Record<string, unknown>;
}

export interface TicketGroupDeletedEvent extends DomainEvent {
  type: 'ticketGroup.deleted';
  groupId: string;
}

export interface TicketGroupMemberAddedEvent extends DomainEvent {
  type: 'ticketGroup.memberAdded';
  groupId: string;
  ticketId: string;
}

export interface TicketGroupMemberRemovedEvent extends DomainEvent {
  type: 'ticketGroup.memberRemoved';
  groupId: string;
  ticketId: string;
}

export interface TicketRelationshipCreatedEvent extends DomainEvent {
  type: 'ticketRelationship.created';
  parentId: string;
  childId: string;
}

export interface TicketRelationshipDeletedEvent extends DomainEvent {
  type: 'ticketRelationship.deleted';
  parentId: string;
  childId: string;
}

export interface TicketGroupBoardAddedEvent extends DomainEvent {
  type: 'ticketGroup.boardAdded';
  groupId: string;
  boardId: string;
}

export interface TicketGroupBoardRemovedEvent extends DomainEvent {
  type: 'ticketGroup.boardRemoved';
  groupId: string;
  boardId: string;
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
  | MentionWokenUpEvent
  | MentionDeletedEvent
  | DeliverableCreatedEvent
  | DeliverableUpdatedEvent
  | DeliverableDeletedEvent
  | PersonaCreatedEvent
  | PersonaUpdatedEvent
  | PersonaDeletedEvent
  | PersonaExecutionStartedEvent
  | SkillCreatedEvent
  | SkillUpdatedEvent
  | SkillDeletedEvent
  | SkillExecutedEvent
  | PanelCreatedEvent
  | PanelUpdatedEvent
  | PanelDeletedEvent
  | PanelExecutedEvent
  | WorktreeCreatedEvent
  | SessionCreatedEvent
  | SessionRenamedEvent
  | SessionKilledEvent
  | SessionHookStatusChangedEvent
  | TicketGroupCreatedEvent
  | TicketGroupUpdatedEvent
  | TicketGroupDeletedEvent
  | TicketGroupMemberAddedEvent
  | TicketGroupMemberRemovedEvent
  | TicketRelationshipCreatedEvent
  | TicketRelationshipDeletedEvent
  | TicketGroupBoardAddedEvent
  | TicketGroupBoardRemovedEvent;

// ── Event type string union ──

export type DomainEventType = AnyDomainEvent['type'];
