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
  /** Re-point an existing local branch at `startPoint` (`git branch -f --no-track`). */
  forceBranch(repoPath: string, branch: string, startPoint: string): Promise<void>;
  /**
   * Commits on `branch` that no other remote branch has — the work only this
   * branch carries (its own `origin/<branch>` copy doesn't count as elsewhere).
   * 0 means the branch is a mere pointer into history published elsewhere.
   */
  countOwnCommits(repoPath: string, branch: string): Promise<number>;
  /** True when `ancestor` is reachable from `ref`; false when not, or unresolvable. */
  isAncestor(repoPath: string, ancestor: string, ref: string): Promise<boolean>;
  moveWorktree(repoPath: string, wtPath: string, newPath: string): Promise<void>;
  getDefaultBranch(repoPath: string): Promise<string>;
  /**
   * True when `origin` has a branch head named exactly `branch`. Uses
   * `git ls-remote --heads` (a cheap network round-trip, no full fetch) so a
   * base branch can be validated at attach time.
   */
  remoteBranchExists(repoPath: string, branch: string): Promise<boolean>;
  fetch(repoPath: string): Promise<void>;
  fetchRef(repoPath: string, refspec: string): Promise<void>;
  cloneBare(remote: string, barePath: string): Promise<void>;
  getDiffStats(repoPath: string, branch: string, baseBranch?: string): Promise<DiffStats>;
  getDiffSummary(repoPath: string, branch: string, baseBranch?: string): Promise<string>;
  getLogOneline(repoPath: string, branch: string, baseBranch?: string, limit?: number): Promise<string>;
  /**
   * Raw unified `git diff` of the worktree's working tree vs the merge-base of
   * `baseBranch` (default: `origin/<default>`) and HEAD — captures committed,
   * staged and unstaged changes. Runs in the worktree checkout, not the bare.
   */
  getDiffPatch(worktreePath: string, baseBranch?: string): Promise<string>;
  /** `git ls-tree -r --name-only HEAD` — newline-separated tracked paths. */
  listTrackedFiles(worktreePath: string): Promise<string>;
  /**
   * File names changed vs the merge-base of `baseBranch` (default:
   * `origin/<default>`) and the working tree — the same universe as
   * `getDiffPatch`, so tree "changed" markers match the diff (includes
   * committed changes, not just uncommitted). Excludes untracked files.
   */
  getChangedFiles(worktreePath: string, baseBranch?: string): Promise<string[]>;
  /** Unified `git diff` for a single file vs the merge-base (for the editor gutter). */
  getFileDiffPatch(worktreePath: string, path: string, baseBranch?: string): Promise<string>;
  /** A file's contents at the merge-base (for the editor's side-by-side diff); '' if absent there. */
  getFileBaseContent(worktreePath: string, path: string, baseBranch?: string): Promise<string>;
  /** `git status --porcelain` output for the worktree. */
  getStatusPorcelain(worktreePath: string): Promise<string>;
  repairWorktrees(repoPath: string): Promise<void>;
  pruneWorktrees(repoPath: string): Promise<void>;
}
