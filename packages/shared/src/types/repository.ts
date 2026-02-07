export interface Repository {
  readonly org: string;
  readonly name: string;
  readonly path: string;
  readonly defaultBranch: string;
  readonly remote: string;
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
}

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly headRefName: string;
}
