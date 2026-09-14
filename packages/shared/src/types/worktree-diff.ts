/**
 * Read-only diff, file-tree and file-content shapes for the Work view's Diff /
 * Code panels (Phase 2b). Served by `GET /api/worktrees/:id/{diff,tree,file}`,
 * where `:id` is the ticket id. A ticket can attach several repos, each with its
 * own worktree, so the diff/tree responses are lists keyed by repo (combined
 * view). An empty `repos` array means the ticket has no materialized worktree.
 */

export type DiffLineKind = 'ctx' | 'add' | 'del';

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

export interface DiffHunk {
  /** The full `@@ -a,b +c,d @@ …` header line. */
  readonly header: string;
  readonly lines: DiffLine[];
}

export interface DiffFile {
  /** Repo-relative POSIX path. */
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  /** Empty for binary files. */
  readonly hunks: DiffHunk[];
  readonly binary?: boolean;
}

/** One repo's working-branch diff vs its base. */
export interface RepoDiff {
  readonly repo: string;
  /** The base ref the diff is computed against (e.g. `origin/main`). */
  readonly base: string;
  /** The head branch. */
  readonly head: string;
  /** Absolute worktree checkout path (for "Open in editor"). */
  readonly path: string;
  readonly files: DiffFile[];
  /** Set when this repo's raw patch exceeded the size cap and was clipped. */
  readonly truncated?: boolean;
}

export interface WorktreeDiff {
  readonly repos: RepoDiff[];
}

export type FileTreeKind = 'dir' | 'file';

export interface FileTreeNode {
  readonly name: string;
  /** Repo-relative POSIX path. */
  readonly path: string;
  readonly kind: FileTreeKind;
  /** File: has uncommitted changes. Dir: contains a changed descendant. */
  readonly changed?: boolean;
  readonly children?: FileTreeNode[];
}

/** One repo's file tree. */
export interface RepoTree {
  readonly repo: string;
  readonly branch: string;
  /** Absolute worktree checkout path (for "Open in VS Code"). */
  readonly path: string;
  readonly nodes: FileTreeNode[];
}

export interface WorktreeTree {
  readonly repos: RepoTree[];
}

/** A single file's contents, for the Code editor. */
export interface WorktreeFile {
  readonly repo: string;
  /** Repo-relative POSIX path. */
  readonly path: string;
  readonly content: string;
  /** New-side line numbers changed vs base (for the editor's diff gutter). */
  readonly changedLines: number[];
  /** Set when the file was clipped to the size cap. */
  readonly truncated?: boolean;
  /** Set when the file is binary; `content` is then empty. */
  readonly binary?: boolean;
}
