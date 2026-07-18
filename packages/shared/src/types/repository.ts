export interface Repository {
  readonly org: string;
  readonly name: string;
  readonly barePath: string;
  readonly defaultBranch: string;
  readonly remote: string;
  readonly isCloned: boolean;
}

export interface Worktree {
  readonly path: string;
  readonly branch: string;
  readonly isMain: boolean;
  readonly isBare: boolean;
}

export interface GitRemoteInfo {
  readonly org: string;
  readonly name: string;
  readonly remote: string;
  readonly branch: string;
  readonly isWorktree: boolean;
  readonly mainWorktreePath: string;
}

export interface CreateWorktreeRequest {
  readonly branch: string;
  readonly createNewBranch: boolean;
  readonly baseBranch?: string;
  readonly prNumber?: number;
  readonly issueNumber?: number;
}

export interface HookResult {
  readonly ran: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface CreateWorktreeResponse {
  readonly path: string;
  readonly hookStarted?: boolean;
}

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly headRefName: string;
  readonly state: 'open' | 'merged' | 'closed';
  readonly isDraft?: boolean;
  readonly author: string;
  readonly assignees: string[];
  readonly reviewRequests?: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mergedAt?: string;
}

export interface DiffStats {
  readonly commitsAhead: number;
  readonly commitsBehind: number;
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
}

export interface GitHubLabel {
  readonly name: string;
  readonly color: string;
}

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly author: string;
  readonly assignees: string[];
  readonly labels: GitHubLabel[];
  readonly commentsCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
}

export interface GitHubIssueDetail {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly state: string;
  readonly author: string;
  readonly assignees: string[];
  readonly labels: string[];
  readonly milestone: string | null;
  readonly comments: Array<{ author: string; body: string; createdAt: string }>;
}

export interface DiscoveredRepo {
  readonly nameWithOwner: string;
  readonly visibility: string;
  readonly updatedAt: string;
}

export interface RepoDiscoveryOwner {
  readonly login: string;
  readonly repos: DiscoveredRepo[];
}

export interface RepoDiscovery {
  readonly owners: RepoDiscoveryOwner[];
  readonly totalRepos: number;
}

export interface RepoDailyCost {
  readonly date: string; // YYYY-MM-DD
  readonly costUsd: number;
}

export interface RepositoryStats {
  readonly totalCostUsd: number; // window [start of day (now-(days-1)d) UTC, now]
  readonly previousTotalCostUsd: number; // the `days` UTC days before that window
  readonly costPerTicketUsd: number; // total / #tickets with cost in window
  readonly ticketsWithCostCount: number;
  readonly days: number;
  readonly dailyCosts: RepoDailyCost[]; // one entry per day, oldest first, zero-filled
}
