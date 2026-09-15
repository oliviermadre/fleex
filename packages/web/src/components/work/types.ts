/**
 * View-models for the Work view. These are normalised projections assembled by
 * useWorkQueue from the real stores (ticketStore, ticketActivityStore,
 * pullRequestStore, sessionStore…). Presentational components depend only on
 * these shapes, never on a store directly, so they stay testable and the data
 * wiring lives in one place.
 */
import type { QueueActivity } from './selectors';

export interface WorkWorktree {
  repo: string;
  branch: string;
  /** Worktree id, when known (for detach). */
  worktreeId?: string;
}

export interface WorkPullRequest {
  /** e.g. "owner/repo#2782". */
  ref: string;
  checksLabel: string | null;
  additions: number | null;
  deletions: number | null;
  url?: string;
}

/** A linked PR's state as the queue glyph shows it (draft = an open PR not ready yet). */
export type WorkPrState = 'open' | 'draft' | 'merged' | 'closed';

/** One pull request linked to a task (`github_pr` link), with its live details once loaded. */
export interface WorkPrLink {
  /** The link ref, "org/name#123". */
  ref: string;
  /** Display label, "name#123". */
  label: string;
  url: string;
  /** null until GitHub has answered. */
  state: WorkPrState | null;
  title: string | null;
  additions: number | null;
  deletions: number | null;
}

/**
 * One task as every Work surface (queue row, center, context panel, status bar)
 * needs it — a ticket plus its live activity and related entities.
 */
export interface WorkTask {
  id: string;
  number: number | null;
  title: string;
  boardId: string | null;
  boardName: string | null;
  status: string;
  type: string | null;
  size: string | null;
  priority: string;
  favorite: boolean;
  blocked: boolean;

  activity: QueueActivity;
  /** Human label for the current activity, e.g. "builder · running tests". */
  activityDetail: string | null;
  since: number | null;
  lastActivityAt: number | null;
  cost: number | null;
  runningExecutionId: string | null;

  /** Workflow progress 0..1 when a run is active, else null (indeterminate). */
  progress: number | null;

  worktrees: WorkWorktree[];
  suggestedRepos: string[];
  /** Total changed lines (additions + deletions) on the worktree, 0 when none. */
  changedLines: number;
  pr: WorkPullRequest | null;
  /** Every PR linked to the task, in link order. */
  prs: WorkPrLink[];
  deliverableCount: number;
  sessionCount: number;
}

/** A rendered group of tasks in the queue (section header + rows). */
export interface QueueGroup {
  key: string;
  label: string;
  /** Optional Tailwind text-color class for the header (activity groups tint). */
  tone?: string;
  items: WorkTask[];
}
