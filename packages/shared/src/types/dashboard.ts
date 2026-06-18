import type { Ticket, DeliverableType, DeliverableStatus, TicketStatus } from './ticket.js';
import type { PullRequest, Worktree, GitHubIssue } from './repository.js';

export interface DashboardPullRequest extends PullRequest {
  readonly org: string;
  readonly name: string;
  linkedTicketId?: string;
}

export interface DashboardWorktree extends Worktree {
  readonly org: string;
  readonly name: string;
}

export interface DashboardGitHubIssue extends GitHubIssue {
  readonly org: string;
  readonly name: string;
  readonly hasLocalTicket: boolean;
  readonly linkedTicketId?: string;
}

// ── Launchpad: KPI stat strip ──

export interface DashboardStats {
  readonly liveRuns: number;
  readonly liveRunsNeedReview: number;
  readonly needsReview: number;
  readonly needsReviewFailed: number;
  readonly prsMine: number;
  readonly prsDraft: number;
  readonly prsConflict: number;
  readonly deliverablesToday: number;
  readonly spendTodayUsd: number;
}

// ── Launchpad: Needs-You action queue ──

export type NeedsYouKind =
  | 'failed_run'
  | 'mention_waiting'
  | 'plan_ready'
  | 'review_requested'
  | 'stale';

export interface NeedsYouItem {
  readonly id: string;
  readonly kind: NeedsYouKind;
  readonly title: string;
  readonly subtitle: string;
  readonly ticketId: string | null;
  readonly ticketDisplayId: number | null;
  /** ISO timestamp used for recency sort. */
  readonly at: string;
  /** Optional external deep link (e.g. PR url). */
  readonly href?: string | null;
}

// ── Launchpad: In-Flight executions (read-only summary, links to Execution Log) ──

export type InFlightKind = 'flow' | 'agent' | 'panel' | 'skill';

export interface InFlightItem {
  readonly id: string;
  readonly kind: InFlightKind;
  readonly title: string;
  readonly ticketId: string | null;
  readonly ticketDisplayId: number | null;
  readonly status: string;
  readonly detail?: string | null;
  /** flow: current step position (1-based) and total. */
  readonly stepIndex?: number | null;
  readonly stepTotal?: number | null;
  /** panel: completed members vs total. */
  readonly membersDone?: number | null;
  readonly membersTotal?: number | null;
  /** Link into the Execution Log. */
  readonly executionId?: string | null;
  readonly at: string;
}

// ── Launchpad: Recent agentic outputs ──

export interface DashboardDeliverable {
  readonly id: string;
  readonly ticketId: string;
  readonly ticketDisplayId: number | null;
  readonly agentName: string;
  readonly type: DeliverableType;
  readonly title: string;
  readonly status: DeliverableStatus;
  readonly createdAt: string;
}

// ── Launchpad: Active recent tickets ──

/** Source that contributed to a ticket's most recent activity timestamp. */
export type TicketActivitySource = 'updated' | 'comment' | 'deliverable' | 'mention';

export interface ActiveRecentTicket {
  readonly id: string;
  readonly displayId: number;
  readonly title: string;
  readonly status: TicketStatus;
  /** ISO timestamp of the most recent activity across all sources. */
  readonly lastActivityAt: string;
  readonly activitySources: TicketActivitySource[];
}

export interface DashboardData {
  readonly activeTickets: Ticket[];
  readonly myPullRequests: DashboardPullRequest[];
  readonly reviewRequests: DashboardPullRequest[];
  readonly myIssues: DashboardGitHubIssue[];
  readonly assignedIssues: DashboardGitHubIssue[];
  readonly activeWorktrees: DashboardWorktree[];
  readonly githubUser: string;

  // ── Launchpad additions (optional → backward-compatible) ──
  readonly stats?: DashboardStats;
  readonly needsYou?: NeedsYouItem[];
  readonly inFlight?: InFlightItem[];
  readonly recentOutputs?: DashboardDeliverable[];
  readonly activeRecentTickets?: ActiveRecentTicket[];
}
