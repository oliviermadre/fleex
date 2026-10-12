/**
 * `fleex worktree cleanup` — the plan / apply report shared by the server
 * (which computes it) and the CLI (which renders it or prints it as JSON).
 *
 * The JSON is a contract for scheduled consumers (a weekly report routine):
 * `version` is bumped on any breaking change, and the reason codes are stable.
 */

export const WORKTREE_CLEANUP_SCHEMA_VERSION = 1;

/** Only closed tickets are ever cleaned up — an active ticket is never in scope. */
export const WORKTREE_CLEANUP_STATUSES = ['done', 'cancelled'] as const;
export type WorktreeCleanupStatus = (typeof WORKTREE_CLEANUP_STATUSES)[number];

export const DEFAULT_CLEANUP_OLDER_THAN = '14d';

/**
 * Why a worktree is kept. Any one of them excludes the worktree from the plan.
 * A check that cannot conclude (`*_failed`, `pr_state_unknown`) excludes too:
 * we never delete on a doubt.
 */
export const WORKTREE_CLEANUP_REASONS = [
  'dirty',
  'untracked_files',
  'unpushed_commits',
  'pr_open',
  'pr_state_unknown',
  'fetch_failed',
  'tmux_session',
  'process_running',
  'process_check_failed',
  'git_status_failed',
  'not_a_worktree',
  'unregistered_worktree',
] as const;
export type WorktreeCleanupReason = (typeof WORKTREE_CLEANUP_REASONS)[number];

/** `routine_workspace`: a routine run's folder (`{ routineId }` manifest) — not a ticket's, out of scope. */
export type WorktreeCleanupUnknownReason = 'no_manifest' | 'manifest_invalid' | 'ticket_not_found' | 'routine_workspace';

export type WorktreeCleanupBranchAction = 'delete_local_merged' | 'keep_local_unmerged' | 'none_detached';

export type WorktreeCleanupPrState = 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN';

export interface WorktreeCleanupCriteria {
  olderThanDays: number;
  /** The raw `--older-than` value, e.g. `36h`. */
  olderThan: string;
  statuses: WorktreeCleanupStatus[];
  ticket: string | null;
}

export interface WorktreeCleanupWorktree {
  path: string;
  /** `org/name`, or null when the folder could not be tied to a bare clone. */
  repo: string | null;
  /** Null on a detached HEAD. */
  branch: string | null;
  sizeBytes: number | null;
  decision: 'eligible' | 'excluded';
  reasons: WorktreeCleanupReason[];
  details: {
    unpushedCommits: number;
    dirtyLines: number;
    untracked: string[];
    prs: { number: number; state: WorktreeCleanupPrState }[];
    tmuxPanes: number;
    processes: { pid: number; command?: string }[];
  };
  branchAction: WorktreeCleanupBranchAction;
  /** Apply only. */
  result?: 'removed' | 'skipped_guard' | 'failed';
  error?: string;
}

export interface WorktreeCleanupOrphanLink {
  linkId: string;
  ref: string;
  label: string | null;
  /** Apply only. */
  result?: 'purged' | 'failed';
  error?: string;
}

export interface WorktreeCleanupTicket {
  ticketId: string;
  displayId: number | null;
  title: string;
  status: string;
  statusChangedAt: string | null;
  closedForDays: number;
  workspacePath: string | null;
  worktrees: WorktreeCleanupWorktree[];
  orphanLinks: WorktreeCleanupOrphanLink[];
}

export interface WorktreeCleanupEmptyWorkspace {
  ticketId: string;
  displayId: number | null;
  path: string;
  /** Apply only. */
  result?: 'removed' | 'failed';
  error?: string;
}

export interface WorktreeCleanupUnknownDir {
  path: string;
  reason: WorktreeCleanupUnknownReason;
  ticketId: string | null;
  sizeBytes: number | null;
}

export interface WorktreeCleanupSkippedTicket {
  ticketId: string;
  displayId: number | null;
  title: string;
  status: string;
  closedForDays: number | null;
}

export interface WorktreeCleanupTotals {
  /** Distinct tickets looked at: tied to a workspace folder, or holding worktree links. */
  ticketsScanned: number;
  ticketsInScope: number;
  worktreesEligible: number;
  worktreesExcluded: number;
  orphanLinks: number;
  emptyWorkspaces: number;
  unknownDirs: number;
  /** Sum of eligible sizes; null when sizes were not computed. */
  reclaimableBytes: number | null;
  /** Apply only. */
  removed?: number;
  skipped?: number;
  failed?: number;
  freedBytes?: number;
  purgedLinks?: number;
}

export interface WorktreeCleanupReport {
  version: typeof WORKTREE_CLEANUP_SCHEMA_VERSION;
  mode: 'plan' | 'apply';
  generatedAt: string;
  basePath: string;
  criteria: WorktreeCleanupCriteria;
  /** Tickets in scope (closed long enough) that hold worktrees or orphan links. */
  tickets: WorktreeCleanupTicket[];
  /** Workspaces of tickets out of scope (closed too recently, or not closed). */
  skipped: WorktreeCleanupSkippedTicket[];
  emptyWorkspaces: WorktreeCleanupEmptyWorkspace[];
  unknown: WorktreeCleanupUnknownDir[];
  totals: WorktreeCleanupTotals;
  /** Apply only: true when the run stopped early (client went away). */
  interrupted?: boolean;
}

export interface WorktreeCleanupRequest {
  olderThan?: string;
  status?: string;
  ticket?: string;
  size?: boolean;
}

const DURATION_UNITS_MS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

/**
 * Parse an `--older-than` value: `36h`, `14d`, `2w`, or a bare number of days.
 * Returns milliseconds, or null when the value is not a duration.
 */
export function parseCleanupOlderThan(input: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([hdw]?)\s*$/i.exec(input);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = (m[2] || 'd').toLowerCase();
  const ms = value * DURATION_UNITS_MS[unit]!;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Parse a `--status` CSV. Only `done` / `cancelled` are accepted: anything else
 * is an error, because cleaning up an active ticket is never what you want.
 */
export function parseCleanupStatuses(input: string): { statuses: WorktreeCleanupStatus[] } | { error: string } {
  const parts = input.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return { error: '--status is empty. Accepted values: done, cancelled' };
  const bad = parts.filter((p) => !(WORKTREE_CLEANUP_STATUSES as readonly string[]).includes(p));
  if (bad.length > 0) {
    return { error: `--status: "${bad.join(', ')}" refused. Accepted values: done, cancelled (an active ticket is never cleaned up)` };
  }
  return { statuses: [...new Set(parts)] as WorktreeCleanupStatus[] };
}
