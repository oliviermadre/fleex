import type { MentionTargetType, MentionExecutionMode, HookResult } from '@fleex/shared';

// ── Base ──

export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
  /**
   * `false` marks an event that must be broadcast but NOT recorded.
   *
   * Broadcasting and auditing are two different jobs done by two different
   * subscribers of the same bus: `broadcast-registrar` pushes to WS clients,
   * while the `on('*')` sink in `container.ts` persists a domain event log row.
   * A background save (`PATCH /api/tickets/:id?silent=true`, fired every 500 ms
   * by the description autosave) must still reach other clients, but must not
   * write one audit row per keystroke.
   *
   * Defaults to audited when absent.
   */
  readonly audit?: false;
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

// Semantic ticket events — emitted instead of a generic `ticket.updated`
// so the audit trail records *what* the user did, not an opaque diff.

export interface TicketLinkAddedEvent extends DomainEvent {
  type: 'ticket.linkAdded';
  ticketId: string;
  linkType: string;
  ref: string;
  label: string;
}

export interface TicketLinkRemovedEvent extends DomainEvent {
  type: 'ticket.linkRemoved';
  ticketId: string;
  /** Best-effort metadata of the removed link (the link is gone by emit time). */
  linkType?: string;
  ref?: string;
  label?: string;
}

export interface TicketFavoritedEvent extends DomainEvent {
  type: 'ticket.favorited';
  ticketId: string;
}

export interface TicketUnfavoritedEvent extends DomainEvent {
  type: 'ticket.unfavorited';
  ticketId: string;
}

export interface TicketBlockedEvent extends DomainEvent {
  type: 'ticket.blocked';
  ticketId: string;
}

export interface TicketUnblockedEvent extends DomainEvent {
  type: 'ticket.unblocked';
  ticketId: string;
}

export interface TicketTagsChangedEvent extends DomainEvent {
  type: 'ticket.tagsChanged';
  ticketId: string;
  added: string[];
  removed: string[];
}

export interface TicketSyncedFromGithubEvent extends DomainEvent {
  type: 'ticket.syncedFromGithub';
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
  /**
   * Agents that must NOT be woken by this comment even if they are
   * waiting_for_info — the user re-mentioned them for a SEPARATE subject (or the
   * disambiguation defaulted that way), so their pending question stays open.
   */
  wakeExcludeAgents?: string[];
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

/**
 * Emitted when an agent execution triggered by a mention crashes — either at
 * startup (pre-`acknowledged`: workspace error, usage limit, not logged in) or
 * mid-run (post-`acknowledged`: usage limit, max turns, subprocess crash). In
 * every case the mention is transitioned to `failed` (see `markFailed`) and a
 * companion `mention:updated` carries the new status, so the crash card renders
 * and survives a reload. The UI uses this event's `reason`/`message` to show the
 * precise remediation and offer a one-click relaunch.
 */
export interface MentionExecutionFailedEvent extends DomainEvent {
  type: 'mention.execution_failed';
  mentionId: string;
  ticketId: string;
  targetAgent: string;
  /** Short machine code: 'usage_limit' | 'not_authenticated' | 'max_turns' | 'startup_error' | 'unknown' | ... */
  reason: string;
  /** Human-readable message for the UI to display verbatim. */
  message: string;
}

export interface MentionExecutionModeChangedEvent extends DomainEvent {
  type: 'mention.executionModeChanged';
  mentionId: string;
  ticketId: string;
  from: MentionExecutionMode;
  to: MentionExecutionMode;
}

// ── Agent execution events ──

export interface ExecutionCancelledEvent extends DomainEvent {
  type: 'execution.cancelled';
  executionId: string;
  mentionId: string;
  personaId: string;
  ticketId?: string;
}

// ── Deliverable events ──

export interface DeliverableCreatedEvent extends DomainEvent {
  type: 'deliverable.created';
  deliverableId: string;
  ticketId: string;
  agentName: string;
  status: 'draft' | 'final';
  /** Deliverable title — carried in the payload so consumers (e.g. audit-trail
   *  reconstruction) don't have to re-fetch the deliverable to label it. */
  title: string;
}

export interface DeliverableUpdatedEvent extends DomainEvent {
  type: 'deliverable.updated';
  deliverableId: string;
  ticketId: string;
  agentName: string;
  oldStatus: string;
  newStatus: string;
  /** Deliverable type before/after the update (equal when the type was not changed). */
  oldType: string;
  newType: string;
  /** Deliverable title — see DeliverableCreatedEvent. */
  title: string;
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

// ── Workflow events ──

export interface WorkflowRunCreatedEvent extends DomainEvent {
  type: 'workflow.run_created';
  workflowRunId: string;
  ticketId: string;
  templateId: string;
}

export interface WorkflowStepStartedEvent extends DomainEvent {
  type: 'workflow.step_started';
  workflowRunId: string;
  stepRunId: string;
  stepId: string;
  ticketId: string;
}

export interface WorkflowStepCompletedEvent extends DomainEvent {
  type: 'workflow.step_completed';
  workflowRunId: string;
  stepRunId: string;
  stepId: string;
  ticketId: string;
  nextEdgeId: string | null;
}

export interface WorkflowNeedsReviewEvent extends DomainEvent {
  type: 'workflow.needs_review';
  workflowRunId: string;
  stepRunId: string;
  stepId: string;
  ticketId: string;
}

export interface WorkflowStepCancelledEvent extends DomainEvent {
  type: 'workflow.step_cancelled';
  workflowRunId: string;
  stepRunId: string;
  stepId: string;
  ticketId: string;
}

export interface WorkflowRunCompletedEvent extends DomainEvent {
  type: 'workflow.run_completed';
  workflowRunId: string;
  ticketId: string;
}

export interface WorkflowRunFailedEvent extends DomainEvent {
  type: 'workflow.run_failed';
  workflowRunId: string;
  stepRunId: string;
  stepId: string;
  ticketId: string;
  error: string;
}

export interface WorkflowRunCancelledEvent extends DomainEvent {
  type: 'workflow.run_cancelled';
  workflowRunId: string;
  ticketId: string;
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

export interface WorktreeDeletedEvent extends DomainEvent {
  type: 'worktree.deleted';
  repoPath: string;
  worktreePath: string;
  /** Branch the worktree was checked out on, when resolvable. */
  branch?: string;
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
  | TicketLinkAddedEvent
  | TicketLinkRemovedEvent
  | TicketFavoritedEvent
  | TicketUnfavoritedEvent
  | TicketBlockedEvent
  | TicketUnblockedEvent
  | TicketTagsChangedEvent
  | TicketSyncedFromGithubEvent
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
  | MentionExecutionFailedEvent
  | MentionExecutionModeChangedEvent
  | ExecutionCancelledEvent
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
  | WorktreeDeletedEvent
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
  | TicketGroupBoardRemovedEvent
  | WorkflowRunCreatedEvent
  | WorkflowStepStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowStepCancelledEvent
  | WorkflowNeedsReviewEvent
  | WorkflowRunCompletedEvent
  | WorkflowRunFailedEvent
  | WorkflowRunCancelledEvent;

// ── Event type string union ──

export type DomainEventType = AnyDomainEvent['type'];
