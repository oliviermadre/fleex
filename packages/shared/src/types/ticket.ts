export type TicketStatus = 'backlog' | 'todo' | 'doing' | 'reviewing' | 'done' | 'cancelled';
export type TicketPriority = 'none' | 'low' | 'medium' | 'high';
export type TicketType = 'build' | 'fix' | 'review' | 'ops' | 'lead' | 'think';
export type TicketLinkType = 'github_issue' | 'github_pr' | 'worktree' | 'session' | 'repository';

export interface TicketLink {
  readonly id: string;
  readonly type: TicketLinkType;
  readonly ref: string;
  readonly label: string;
  readonly url: string | null;
  readonly createdAt: string;
}

export interface GitHubIssueMetadata {
  readonly state: string;
  readonly author: string;
  readonly assignees: string[];
  readonly labels: string[];
  readonly milestone: string | null;
  readonly syncedAt: string;
}

export interface Ticket {
  readonly id: string;
  readonly boardId: string;
  readonly displayId: number;
  readonly title: string;
  readonly description: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly type: TicketType | null;
  readonly position: number;
  readonly tags: string[];
  readonly links: TicketLink[];
  readonly blocked: boolean;
  readonly favorite: boolean;
  readonly dueDate: string | null;
  readonly assignee: string | null;
  readonly agentClaimedAt: string | null;
  readonly githubMetadata: GitHubIssueMetadata | null;
  readonly archivedAt: string | null;
  readonly firstDoingAt: string | null;
  readonly statusChangedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Board {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly nextDisplayId: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BoardWithCounts extends Board {
  readonly ticketCounts: Record<TicketStatus, number>;
}

export interface CreateTicketRequest {
  readonly boardId: string;
  readonly title: string;
  readonly description?: string;
  readonly status?: TicketStatus;
  readonly priority?: TicketPriority;
  readonly type?: TicketType | null;
  readonly tags?: string[];
  readonly links?: Omit<TicketLink, 'id' | 'createdAt'>[];
  readonly dueDate?: string | null;
  readonly githubIssueUrl?: string;
  readonly worktreeBranch?: string;
}

export interface UpdateTicketRequest {
  readonly boardId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly status?: TicketStatus;
  readonly priority?: TicketPriority;
  readonly type?: TicketType | null;
  readonly position?: number;
  readonly tags?: string[];
  readonly blocked?: boolean;
  readonly favorite?: boolean;
  readonly dueDate?: string | null;
  readonly assignee?: string | null;
}

export interface CreateBoardRequest {
  readonly name: string;
  readonly emoji?: string;
}

export interface UpdateBoardRequest {
  readonly name?: string;
  readonly emoji?: string;
}

export interface TicketActivity {
  readonly id: string;
  readonly ticketId: string;
  readonly action: string;
  readonly changes: Record<string, { from: unknown; to: unknown }>;
  readonly actorType: 'user' | 'agent';
  readonly actorName: string | null;
  readonly source: 'web' | 'api';
  readonly createdAt: string;
}

export interface TicketActivitySummary {
  readonly ticketId: string;
  readonly displayId: number;
  readonly title: string;
  readonly status: TicketStatus;
  readonly boardId: string;
  readonly activityCount: number;
  readonly lastActivityAt: string; // ISO 8601
  readonly eventTypes: string[];   // e.g. ["comment.posted", "ticket.moved"]
}

export interface AgentToken {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export interface AgentTokenCreated extends AgentToken {
  readonly secret: string;
}

// ── Comments ──

export type CommentVisibility = 'public' | 'private';

export interface TicketComment {
  readonly id: string;
  readonly ticketId: string;
  readonly authorType: 'user' | 'agent';
  readonly authorName: string;
  readonly body: string;
  readonly visibility: CommentVisibility;
  readonly privateRecipients: string[];
  readonly mentions: string[];
  readonly parentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Mentions ──

export type MentionStatus = 'pending' | 'acknowledged' | 'resolved' | 'waiting_for_info';

export type MentionTargetType = 'agent' | 'human' | 'panel';

export type MentionExecutionMode = 'talk' | 'plan' | 'edit';

export interface TicketMention {
  readonly id: string;
  readonly ticketId: string;
  readonly commentId: string;
  readonly targetAgent: string;
  readonly sourceAgent: string;
  readonly targetType: MentionTargetType;
  readonly executionMode: MentionExecutionMode;
  readonly status: MentionStatus;
  readonly resolvedAt: string | null;
  readonly resolvedCommentId: string | null;
  readonly resolvedDeliverableId: string | null;
  readonly createdAt: string;
}

// ── Deliverables ──

export interface TicketDeliverable {
  readonly id: string;
  readonly ticketId: string;
  readonly agentName: string;
  readonly type: string;
  readonly title: string;
  readonly content: string;
  readonly version: number;
  readonly status: 'draft' | 'final';
  readonly mentionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Read Cursors ──

export interface TicketReadCursors {
  readonly ticketId: string;
  readonly commentLastSeenAt: string | null;
}

export interface TicketUnreadCounts {
  readonly ticketId: string;
  readonly unreadComments: number;
  readonly unreadDeliverables: number;
}

// ── Summaries ──

export interface TicketSummaryRef {
  readonly ticketId: string;
  readonly ticketTitle: string;
  readonly ticketStatus: TicketStatus;
  readonly content: string;
  readonly updatedAt: string;
}

// ── Context ──

export interface TicketContextEpic {
  readonly name: string;
  readonly emoji: string;
  readonly description: string;
  readonly timeframe: string;
  readonly groupStatus: string;
}

export interface TicketContext {
  readonly ticket: Ticket;
  readonly comments: TicketComment[];
  readonly mentions: {
    readonly pending: TicketMention[];
    readonly all: TicketMention[];
  };
  readonly deliverables: TicketDeliverable[];
  readonly activity: TicketActivity[];
  readonly relevantSummaries: TicketSummaryRef[];
  readonly epics: TicketContextEpic[];
}

// ── WebSocket ──

export type TicketWsMessageType =
  | 'ticket:created'
  | 'ticket:updated'
  | 'ticket:deleted'
  | 'ticket:moved'
  | 'board:updated'
  | 'comment:created'
  | 'comment:updated'
  | 'comment:deleted'
  | 'mention:created'
  | 'mention:acknowledged'
  | 'mention:resolved'
  | 'mention:updated'
  | 'mention:waiting_for_info'
  | 'mention:deleted'
  | 'deliverable:created'
  | 'deliverable:updated'
  | 'deliverable:deleted';

export interface TicketWsMessage {
  readonly type: TicketWsMessageType;
  readonly data: unknown;
}
