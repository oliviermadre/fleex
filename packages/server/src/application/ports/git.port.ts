import type { DiffStats, GitRemoteInfo, Worktree } from '@fleex/shared';

export interface GitPort {
  getInfo(cwd: string): Promise<GitRemoteInfo>;
  listBranches(repoPath: string): Promise<string[]>;
  listWorktrees(repoPath: string): Promise<Worktree[]>;
  createWorktree(
    repoPath: string,
    wtPath: string,
    branch: string,
    createNew: boolean,
    base?: string,
  ): Promise<void>;
  removeWorktree(repoPath: string, wtPath: string): Promise<void>;
  getDefaultBranch(repoPath: string): Promise<string>;
  fetch(repoPath: string): Promise<void>;
  getDiffStats(repoPath: string, branch: string, baseBranch?: string): Promise<DiffStats>;
  copyEnvFiles(sourceRepo: string, targetPath: string): Promise<void>;
}
