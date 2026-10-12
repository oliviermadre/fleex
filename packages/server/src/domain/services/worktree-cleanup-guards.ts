import type { WorktreeCleanupPrState, WorktreeCleanupReason, WorktreeCleanupWorktree } from '@fleex/shared';

/**
 * Everything the cleanup collected about one worktree, as plain data, so the
 * keep/delete decision is a pure function that tests can drive without git.
 *
 * Convention for checks that could not run: `null` (or the `*Failed` flag).
 * A check that cannot conclude excludes the worktree — never delete on a doubt.
 */
export interface WorktreeGuardFacts {
  /** `ok` when the folder is a worktree registered in its bare clone. */
  registration: 'ok' | 'not_a_worktree' | 'unregistered_worktree';
  /** `git status --porcelain -uall` output; null when git failed. */
  porcelain: string | null;
  /** Overlay files (paths relative to the worktree root) copied in by Fleex: never "user work". */
  overlayFiles: ReadonlySet<string>;
  /** Commits reachable from HEAD and from no remote ref / linked PR ref; null when git failed. */
  unpushedCommits: number | null;
  fetchFailed: boolean;
  /** PRs linked to the ticket on this worktree's repo. */
  prs: { number: number; state: WorktreeCleanupPrState }[];
  /** tmux panes whose cwd is the worktree or below. */
  tmuxPanes: number;
  /** Processes whose cwd is the worktree or below; null when the check failed. */
  processes: { pid: number; command?: string }[] | null;
}

export interface WorktreeGuardVerdict {
  decision: 'eligible' | 'excluded';
  reasons: WorktreeCleanupReason[];
  details: WorktreeCleanupWorktree['details'];
}

/** Porcelain v1 untracked lines are `?? <path>`; everything else is a tracked change. */
function splitPorcelain(porcelain: string): { dirty: string[]; untracked: string[] } {
  const dirty: string[] = [];
  const untracked: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('?? ')) untracked.push(unquote(line.slice(3)));
    else dirty.push(line);
  }
  return { dirty, untracked };
}

/** git quotes paths with special characters: `"a b.txt"`. */
function unquote(path: string): string {
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

/**
 * Evaluate every guard — no short-circuit, so the report gives all the reasons
 * a worktree is kept. Any one reason excludes it.
 */
export function evaluateWorktreeGuards(facts: WorktreeGuardFacts): WorktreeGuardVerdict {
  const reasons: WorktreeCleanupReason[] = [];
  const details: WorktreeCleanupWorktree['details'] = {
    unpushedCommits: facts.unpushedCommits ?? 0,
    dirtyLines: 0,
    untracked: [],
    prs: facts.prs,
    tmuxPanes: facts.tmuxPanes,
    processes: facts.processes ?? [],
  };

  if (facts.registration !== 'ok') reasons.push(facts.registration);

  if (facts.porcelain === null) {
    reasons.push('git_status_failed');
  } else {
    const { dirty, untracked } = splitPorcelain(facts.porcelain);
    details.dirtyLines = dirty.length;
    details.untracked = untracked.filter((p) => !facts.overlayFiles.has(p));
    if (dirty.length > 0) reasons.push('dirty');
    if (details.untracked.length > 0) reasons.push('untracked_files');
  }

  if (facts.unpushedCommits === null) {
    if (!reasons.includes('git_status_failed')) reasons.push('git_status_failed');
  } else if (facts.unpushedCommits > 0) {
    reasons.push('unpushed_commits');
  }

  if (facts.fetchFailed) reasons.push('fetch_failed');
  if (facts.prs.some((p) => p.state === 'OPEN')) reasons.push('pr_open');
  if (facts.prs.some((p) => p.state === 'UNKNOWN')) reasons.push('pr_state_unknown');
  if (facts.tmuxPanes > 0) reasons.push('tmux_session');
  if (facts.processes === null) reasons.push('process_check_failed');
  else if (facts.processes.length > 0) reasons.push('process_running');

  return { decision: reasons.length === 0 ? 'eligible' : 'excluded', reasons, details };
}

/** True when `candidate` is `root` or a path below it. */
export function isPathWithin(candidate: string, root: string): boolean {
  const r = root.endsWith('/') ? root.slice(0, -1) : root;
  return candidate === r || candidate.startsWith(`${r}/`);
}
