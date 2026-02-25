// ── Domain Event envelope ──

export interface EventMeta {
  readonly source?: string;   // 'use-case' | 'api' | 'ws' | 'scheduler'
  readonly actor?: string;    // user / agent name
  readonly correlationId?: string;
}

export interface DomainEvent<T extends string = string, P = unknown> {
  readonly id: string;
  readonly type: T;
  readonly occurredAt: string;  // ISO-8601
  readonly payload: P;
  readonly meta: EventMeta;
}

// ── Event type constants ──

export const EVENT_TYPES = {
  // session
  SESSION_CREATED: 'session.created',
  SESSION_KILLED: 'session.killed',
  SESSION_RENAMED: 'session.renamed',
  SESSION_DISCOVERED: 'session.discovered',

  // ticket
  TICKET_CREATED: 'ticket.created',
  TICKET_UPDATED: 'ticket.updated',
  TICKET_DELETED: 'ticket.deleted',
  TICKET_MOVED: 'ticket.moved',
  TICKET_CLAIMED: 'ticket.claimed',
  TICKET_UNCLAIMED: 'ticket.unclaimed',
  TICKET_ASSIGNED: 'ticket.assigned',
  TICKET_UNASSIGNED: 'ticket.unassigned',
  TICKET_COMPLETED: 'ticket.completed',
  TICKET_LINKED: 'ticket.linked',
  TICKET_UNLINKED: 'ticket.unlinked',
  TICKET_IMPORTED: 'ticket.imported',
  TICKET_GITHUB_SYNCED: 'ticket.githubSynced',

  // board
  BOARD_CREATED: 'board.created',
  BOARD_UPDATED: 'board.updated',
  BOARD_DELETED: 'board.deleted',

  // worktree
  WORKTREE_CREATED: 'worktree.created',
  WORKTREE_DELETED: 'worktree.deleted',

  // comment
  COMMENT_CREATED: 'comment.created',
  COMMENT_UPDATED: 'comment.updated',
  COMMENT_DELETED: 'comment.deleted',

  // mention
  MENTION_CREATED: 'mention.created',
  MENTION_ACKNOWLEDGED: 'mention.acknowledged',
  MENTION_RESOLVED: 'mention.resolved',

  // deliverable
  DELIVERABLE_CREATED: 'deliverable.created',
  DELIVERABLE_UPDATED: 'deliverable.updated',

  // config
  CONFIG_UPDATED: 'config.updated',

  // agent token
  AGENT_TOKEN_CREATED: 'agentToken.created',
  AGENT_TOKEN_REVOKED: 'agentToken.revoked',

  // repository
  REPOSITORY_MERGE_DETECTED: 'repository.mergeDetected',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
