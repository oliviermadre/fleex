import type { TicketStatus } from './ticket.js';

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

/** A worktree enriched for the Repositories cleanup view. */
export interface WorktreeDetail {
  readonly path: string;
  readonly branch: string;
  /** ISO date of the last commit on the worktree (mtime fallback), or null. */
  readonly lastCommitAt: string | null;
  readonly commitsAhead: number;
  readonly commitsBehind: number;
  readonly linkedTicket: {
    readonly id: string;
    readonly displayId: number;
    readonly status: TicketStatus;
  } | null;
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
  /** GitHub mergeability — 'CONFLICTING' means the PR has merge conflicts. */
  readonly mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
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

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly assignees: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
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
