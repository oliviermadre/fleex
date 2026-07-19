import type { PullRequest, GitHubIssue, Worktree, DiffStats } from './repository.js';
import type { TicketStatus, TicketType, TicketPriority } from './ticket.js';

/**
 * Server-resolved link from a git worktree to its Fleex ticket. Resolved
 * authoritatively from the worktree's `.fleex.json` manifest (falling back to
 * the branch-name convention), so it survives after the tmux session ends and
 * even for done/cancelled/archived tickets. Lets the dashboard show which
 * ticket an "orphaned" worktree belonged to without a live session.
 */
export interface WorktreeTicketRef {
  readonly worktreePath: string;
  readonly id: string;
  readonly displayId: number;
  readonly title: string;
  readonly status: TicketStatus;
  readonly type: TicketType | null;
  readonly priority: TicketPriority;
  readonly boardId: string;
}

export interface RepositorySummary {
  readonly org: string;
  readonly name: string;
  readonly openIssuesCount: number;
  readonly myPRsCount: number;
  readonly assignedPRsCount: number;
  readonly openPRsCount: number;
  readonly recentlyMergedPRsCount: number;
  readonly lastFetchedAt: string | null;
  readonly isClonedLocally?: boolean;
}

export interface RepositoryDashboardData {
  readonly org: string;
  readonly name: string;
  readonly openIssues: GitHubIssue[];
  readonly recentlyClosedIssues: GitHubIssue[];
  readonly openPullRequests: PullRequest[];
  readonly recentlyMergedPullRequests: PullRequest[];
  readonly worktrees: Worktree[];
  readonly worktreeTickets: WorktreeTicketRef[];
  readonly diffStats: Record<string, DiffStats>;
  readonly githubUser: string;
  readonly isClonedLocally?: boolean;
}

export type RefreshInterval = 60000 | 120000 | 300000 | 600000 | 1800000 | 3600000 | 0;

export type RepositoryWsMessageType =
  | 'repo:summaries-updated'
  | 'repo:dashboard-updated'
  | 'repo:refresh-started'
  | 'repo:refresh-complete'
  | 'repo:rate-limit-warning';

export interface RepositoryWsMessage {
  readonly type: RepositoryWsMessageType;
  readonly data: unknown;
}
