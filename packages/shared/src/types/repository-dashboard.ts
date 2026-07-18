import type { PullRequest, GitHubIssue, Worktree, DiffStats } from './repository.js';

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
