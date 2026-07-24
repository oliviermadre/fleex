export type TicketStatus = 'backlog' | 'todo' | 'doing' | 'reviewing' | 'done' | 'cancelled';
export type TicketPriority = 'none' | 'low' | 'medium' | 'high';
export type TicketType = 'build' | 'fix' | 'review' | 'ops' | 'lead' | 'think';

/**
 * Conversation-scoped execution mode. Persisted on the ticket and resolved at
 * the moment a mention is acknowledged/woken (NOT stamped per-message). Mirrors
 * the Claude Code mental model where the mode belongs to the conversation.
 */
export type ConversationMode = 'talk' | 'plan' | 'edit';

/** Default mode for a brand-new ticket: read-only, the safest starting point. */
export const DEFAULT_CONVERSATION_MODE: ConversationMode = 'plan';

/**
 * Reasoning-effort level, conversation-scoped override. The full Claude Agent
 * SDK ladder — but NOT every model accepts every level (`xhigh` only exists
 * from Opus 4.7 / Sonnet 5 on, `max` from the 4.6 generation on), and sending
 * an unsupported one is a 400. Never hand a raw level to the SDK: resolve it
 * against the model first with `resolveEffortLevel` (types/model.ts), which is
 * the single gate every execution path goes through.
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Ascending by depth/cost — the order doubles as the clamp ranking. */
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function isConversationMode(v: unknown): v is ConversationMode {
  return v === 'talk' || v === 'plan' || v === 'edit';
}

export function isEffortLevel(v: unknown): v is EffortLevel {
  return typeof v === 'string' && (EFFORT_LEVELS as readonly string[]).includes(v);
}

/** Position in the ladder, or -1 for anything that isn't a level. */
export function effortRank(v: unknown): number {
  return isEffortLevel(v) ? EFFORT_LEVELS.indexOf(v) : -1;
}
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
  // ── Conversation-scoped execution config ──
  // Resolved when a mention is acknowledged/woken, never stamped per-message.
  /** Current mode of the conversation (talk/plan/edit). Defaults to 'plan'. */
  readonly conversationMode: ConversationMode;
  /** When set, overrides the mentioned agent's persona model for the next run. null = inherit persona. */
  readonly modelOverride: string | null;
  /** When set, overrides reasoning effort (if the resolved model supports it). null = model/persona default. */
  readonly effortOverride: EffortLevel | null;
  /** When true, request fast mode (if the resolved model supports it). */
  readonly fastMode: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Partial update of a ticket's conversation-scoped execution config. Applied
 * via PATCH /api/tickets/:id/execution-config. Persisting it never creates a
 * comment; it only affects the NEXT mention that acknowledges/wakes.
 */
export interface UpdateTicketExecutionConfigRequest {
  readonly conversationMode?: ConversationMode;
  /** Pass null to clear the override (inherit persona model). */
  readonly modelOverride?: string | null;
  /** Pass null to clear the override. */
  readonly effortOverride?: EffortLevel | null;
  readonly fastMode?: boolean;
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

export type MentionStatus = 'pending' | 'acknowledged' | 'resolved' | 'waiting_for_info' | 'failed';

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
 * Payload broadcast on the `mention:execution_failed` WS message. Sent whenever
 * an agent execution crashes — either *before* the mention reaches `acknowledged`
 * (startup errors) or *during* the run after acknowledge (usage limit, not logged
 * in, max turns, subprocess crash…). In both cases the mention is transitioned to
 * `failed` and a companion `mention:updated` carries the new status; this payload
 * carries the `reason`/`message` the UI surfaces in the crash card + toast.
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
 * Badge colour for a deliverable type. Concrete CSS colour strings so they can
 * be applied as inline styles consistently across every surface (regardless of
 * Tailwind). `bg` is typically a translucent fill, `text` a solid foreground.
 */
export interface DeliverableTypeColor {
  bg: string;
  text: string;
}

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
   * Badge colour. When unset, the badge falls back to the theme accent colour
   * everywhere (no regression for legacy/uncoloured types).
   */
  color?: DeliverableTypeColor;
  /**
   * System-managed type (e.g. ticket-summary): not offered to agents, and
   * cannot be deleted or renamed through the backoffice.
   */
  system?: boolean;
}

/**
 * Predefined badge colour palette offered in the config UI. Each entry pairs a
 * translucent background with a solid text colour of the same hue, matching the
 * app's existing badge aesthetic.
 */
export const DELIVERABLE_COLOR_PRESETS: { key: string; label: string; bg: string; text: string }[] = [
  { key: 'gray', label: 'Gray', bg: 'rgba(107,114,128,0.14)', text: '#9ca3af' },
  { key: 'red', label: 'Red', bg: 'rgba(239,68,68,0.14)', text: '#f87171' },
  { key: 'rose', label: 'Rose', bg: 'rgba(244,63,94,0.14)', text: '#fb7185' },
  { key: 'orange', label: 'Orange', bg: 'rgba(249,115,22,0.14)', text: '#fb923c' },
  { key: 'amber', label: 'Amber', bg: 'rgba(245,158,11,0.14)', text: '#fbbf24' },
  { key: 'yellow', label: 'Yellow', bg: 'rgba(234,179,8,0.14)', text: '#facc15' },
  { key: 'lime', label: 'Lime', bg: 'rgba(132,204,22,0.14)', text: '#a3e635' },
  { key: 'green', label: 'Green', bg: 'rgba(34,197,94,0.14)', text: '#4ade80' },
  { key: 'emerald', label: 'Emerald', bg: 'rgba(16,185,129,0.14)', text: '#34d399' },
  { key: 'teal', label: 'Teal', bg: 'rgba(20,184,166,0.14)', text: '#2dd4bf' },
  { key: 'cyan', label: 'Cyan', bg: 'rgba(6,182,212,0.14)', text: '#22d3ee' },
  { key: 'blue', label: 'Blue', bg: 'rgba(59,130,246,0.14)', text: '#60a5fa' },
  { key: 'indigo', label: 'Indigo', bg: 'rgba(99,102,241,0.14)', text: '#818cf8' },
  { key: 'violet', label: 'Violet', bg: 'rgba(139,92,246,0.14)', text: '#a78bfa' },
  { key: 'purple', label: 'Purple', bg: 'rgba(168,85,247,0.14)', text: '#c084fc' },
  { key: 'pink', label: 'Pink', bg: 'rgba(236,72,153,0.14)', text: '#f472b6' },
];

/** Resolve a preset by hue key. */
function preset(key: string): DeliverableTypeColor {
  const p = DELIVERABLE_COLOR_PRESETS.find((c) => c.key === key)!;
  return { bg: p.bg, text: p.text };
}

/** The stable id of the auto-generated ticket-summary deliverable. */
export const TICKET_SUMMARY_TYPE = 'ticket-summary';

/**
 * The stable id of the auto-generated per-session summary produced when a manual
 * Claude *CLI* session ends inside a Fleex worktree. Captures the decisions and
 * arbitrations made during the session — knowledge that otherwise lives only in
 * the ephemeral transcript (SDK sessions already persist this via comments).
 */
export const CLI_SESSION_SUMMARY_TYPE = 'cli-session-summary';

/**
 * Default preset — mirrors the historically hardcoded behaviour. Used when a
 * workspace has not customised its deliverable types. `html` is kept for
 * backward compatibility with existing deliverables; new workspaces can add
 * named html-rendered types (e.g. visual-explainer, playground) instead.
 */
export const DEFAULT_DELIVERABLE_TYPES: DeliverableTypeDef[] = [
  { id: 'prd', label: 'PRD', description: 'Product Requirements Document', renderer: 'markdown', color: preset('indigo') },
  { id: 'spec', label: 'Spec', description: 'Technical specification or design document', renderer: 'markdown', color: preset('blue') },
  { id: 'plan', label: 'Plan', description: 'Implementation plan, roadmap, or action items', renderer: 'markdown', color: preset('orange') },
  { id: 'code', label: 'Code', description: 'Code snippet, patch, or implementation', renderer: 'markdown', color: preset('teal') },
  { id: 'report', label: 'Report', description: 'Analysis, audit, review, or research findings', renderer: 'markdown', color: preset('gray') },
  { id: 'url', label: 'URL', description: 'External link (content should be the URL)', renderer: 'markdown', color: preset('cyan') },
  { id: 'html', label: 'HTML', description: 'Self-contained HTML document (rendered as an iframe embed). The content must be a complete `<!DOCTYPE html>...` string.', renderer: 'html', color: preset('amber') },
  { id: TICKET_SUMMARY_TYPE, label: 'Ticket Summary', description: 'Auto-generated ticket summary (system use only)', renderer: 'markdown', color: preset('rose'), system: true },
  { id: CLI_SESSION_SUMMARY_TYPE, label: 'CLI Session Summary', description: 'Auto-generated summary of a manual Claude CLI session (system use only)', renderer: 'markdown', color: preset('teal'), system: true },
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

/**
 * Resolve the configured badge colour for a stored type, or null when none is
 * set (callers then fall back to the theme accent — no regression).
 */
export function colorForType(type: string, types: DeliverableTypeDef[]): DeliverableTypeColor | null {
  return types.find((t) => t.id === type)?.color ?? null;
}

/** Validate a slug used as a deliverable type id. */
export function isValidDeliverableTypeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,48}$/.test(id);
}

/**
 * Strip a single wrapping ```` ```html … ``` ```` (or bare ```` ``` … ``` ````) fence from
 * HTML content. No-op when the content isn't a whole-content fenced block. Used for
 * html-rendered deliverables, where the raw HTML is dropped into an iframe and an LLM may
 * have mistakenly wrapped it in a markdown code fence.
 */
export function stripHtmlCodeFence(content: string): string {
  const m = content.trim().match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/i);
  return m ? m[1]!.trim() : content;
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

// ── Agentic activity (Kanban card indicator, #381) ──

/**
 * Real-time agentic activity of a ticket, surfaced as a pill on the Kanban card.
 * Derived server-side from executions, mentions and workflow runs.
 *
 * - `running`: at least one `AgentExecution` or `WorkflowRun` is actively running.
 * - `waiting`: the ticket needs a human action — an agent set a mention to
 *   `waiting_for_info`, or a workflow run is `needs_review` / `blocked` (human gate).
 * - `idle`: no agentic activity in progress.
 *
 * Precedence when both apply: `waiting` wins (it is the actionable state).
 * Distinct from the manual `ticket.blocked` flag and from the audit-trail
 * `TicketActivity` entries above.
 */
export type AgentActivityState = 'running' | 'waiting' | 'idle';

export interface TicketAgentActivity {
  readonly ticketId: string;
  readonly activity: AgentActivityState;
  /** Optional human-readable detail for the card tooltip. */
  readonly detail?: string;
  /**
   * Timestamp of the last SDK activity on the ticket (cockpit "idle since",
   * #400). Absent/null when the ticket never had an SDK session.
   */
  readonly lastActivityAt?: string | null;
  /**
   * When the CURRENT state began (#400, pass 5 — "Running for 5m",
   * "Waiting for 2h", "idle for 3h"): running → earliest still-running start,
   * waiting → the moment the human gate opened, idle → last SDK activity.
   * Absent when unknown.
   */
  readonly since?: string | null;
  /**
   * Cumulative agentic cost of the ticket (#404): Σ `costUsd` over every
   * `AgentExecution` of the ticket (all origins sdk+cli, `null` counted as 0).
   * Always present; `0` when the ticket has no execution / no computed cost.
   * Drives the Kanban card's coloured cost badge.
   */
  readonly cumulativeCostUsd: number;
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
