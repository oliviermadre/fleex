export type TicketStatus = 'backlog' | 'todo' | 'doing' | 'reviewing' | 'done' | 'cancelled';
export type TicketPriority = 'none' | 'low' | 'medium' | 'high';
export type TicketType = 'build' | 'fix' | 'review' | 'ops' | 'lead' | 'think';
export type TicketLinkType = 'github_issue' | 'github_pr' | 'worktree' | 'session' | 'repository' | 'slack_message';

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

export type MentionTargetType = 'agent' | 'human' | 'panel' | 'skill' | 'workflow';

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

/**
 * Payload broadcast on the `mention:execution_failed` WS message. Sent when
 * an agent execution triggered by ▶ fails before the mention can transition
 * from `pending` to `acknowledged`. The mention DTO itself does not change;
 * the UI uses this to surface an error toast / chip without waiting for an
 * `acknowledged` event that will never arrive.
 */
export interface MentionExecutionFailedPayload {
  readonly mentionId: string;
  readonly ticketId: string;
  readonly targetAgent: string;
  readonly reason: string;
  readonly message: string;
}

// ── Deliverables ──

/**
 * Renderers available for deliverable content. Extensible: add a key here and
 * handle it in the web renderer switch (see FloatingDeliverablePanel).
 */
export const DELIVERABLE_RENDERERS = ['markdown', 'html'] as const;
export type DeliverableRenderer = typeof DELIVERABLE_RENDERERS[number];

/**
 * A configurable deliverable type. `id` is the stable value persisted on each
 * deliverable row; label/description/renderer drive presentation and behaviour.
 * Types are configurable per workspace — {@link DEFAULT_DELIVERABLE_TYPES} is
 * the preset used when a workspace has not customised them.
 */
export interface DeliverableTypeDef {
  /** Stable slug stored on deliverables (e.g. "spec", "visual-explainer"). */
  id: string;
  /** Human-friendly label shown in the UI. */
  label: string;
  /** Shown to the agent in the structured-output instructions to guide choice. */
  description: string;
  /** How the web renders this deliverable's content. */
  renderer: DeliverableRenderer;
  /**
   * System-managed type (e.g. ticket-summary): not offered to agents, and
   * cannot be deleted or renamed through the backoffice.
   */
  system?: boolean;
}

/** The stable id of the auto-generated ticket-summary deliverable. */
export const TICKET_SUMMARY_TYPE = 'ticket-summary';

/**
 * Default preset — mirrors the historically hardcoded behaviour. Used when a
 * workspace has not customised its deliverable types. `html` is kept for
 * backward compatibility with existing deliverables; new workspaces can add
 * named html-rendered types (e.g. visual-explainer, playground) instead.
 */
export const DEFAULT_DELIVERABLE_TYPES: DeliverableTypeDef[] = [
  { id: 'prd', label: 'PRD', description: 'Product Requirements Document', renderer: 'markdown' },
  { id: 'spec', label: 'Spec', description: 'Technical specification or design document', renderer: 'markdown' },
  { id: 'plan', label: 'Plan', description: 'Implementation plan, roadmap, or action items', renderer: 'markdown' },
  { id: 'code', label: 'Code', description: 'Code snippet, patch, or implementation', renderer: 'markdown' },
  { id: 'report', label: 'Report', description: 'Analysis, audit, review, or research findings', renderer: 'markdown' },
  { id: 'url', label: 'URL', description: 'External link (content should be the URL)', renderer: 'markdown' },
  { id: 'html', label: 'HTML', description: 'Self-contained HTML document (rendered as an iframe embed). The content must be a complete `<!DOCTYPE html>...` string.', renderer: 'html' },
  { id: TICKET_SUMMARY_TYPE, label: 'Ticket Summary', description: 'Auto-generated ticket summary (system use only)', renderer: 'markdown', system: true },
];

/**
 * Legacy default type ids. Kept for backward compatibility; new code should
 * read the workspace's configured types instead.
 */
export const DELIVERABLE_TYPES: string[] = DEFAULT_DELIVERABLE_TYPES.map((t) => t.id);

/** Deliverable type is a free-form string driven by per-workspace config. */
export type DeliverableType = string;

export const DELIVERABLE_STATUSES = ['draft', 'final'] as const;
export type DeliverableStatus = typeof DELIVERABLE_STATUSES[number];

/**
 * Legacy guard against the default preset. Prefer validating against the
 * workspace's configured types (see {@link normalizeDeliverableTypes}).
 */
export function isDeliverableType(t: unknown): t is DeliverableType {
  return typeof t === 'string' && DELIVERABLE_TYPES.includes(t);
}

export function isDeliverableStatus(s: unknown): s is DeliverableStatus {
  return typeof s === 'string' && (DELIVERABLE_STATUSES as readonly string[]).includes(s);
}

/**
 * Ensure a usable list of types: fall back to the default preset when none are
 * configured, and guarantee system types (e.g. ticket-summary) are always
 * present even if a customised config omitted them.
 */
export function normalizeDeliverableTypes(
  types: DeliverableTypeDef[] | undefined | null,
): DeliverableTypeDef[] {
  const base = types && types.length > 0
    ? types.map((t) => ({ ...t }))
    : DEFAULT_DELIVERABLE_TYPES.map((t) => ({ ...t }));
  for (const sys of DEFAULT_DELIVERABLE_TYPES.filter((t) => t.system)) {
    if (!base.some((t) => t.id === sys.id)) base.push({ ...sys });
  }
  return base;
}

/**
 * Resolve the renderer for a stored deliverable type, tolerating unknown
 * (e.g. legacy or removed) types by falling back to markdown.
 */
export function rendererForType(type: string, types: DeliverableTypeDef[]): DeliverableRenderer {
  return types.find((t) => t.id === type)?.renderer ?? 'markdown';
}

/** Resolve the display label for a stored type, falling back to the raw id. */
export function labelForType(type: string, types: DeliverableTypeDef[]): string {
  return types.find((t) => t.id === type)?.label ?? type;
}

/** Validate a slug used as a deliverable type id. */
export function isValidDeliverableTypeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,48}$/.test(id);
}

export interface TicketDeliverable {
  readonly id: string;
  readonly ticketId: string;
  readonly agentName: string;
  readonly type: DeliverableType;
  readonly title: string;
  readonly content: string;
  readonly version: number;
  readonly status: DeliverableStatus;
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
  readonly totalComments: number;
  readonly totalDeliverables: number;
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
  | 'mention:execution_failed'
  | 'deliverable:created'
  | 'deliverable:updated'
  | 'deliverable:deleted';

export interface TicketWsMessage {
  readonly type: TicketWsMessageType;
  readonly data: unknown;
}
