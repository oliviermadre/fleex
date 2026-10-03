import type { PrCheck, PrCiBucket, PrCiStatus, PrMergeMethod } from '@fleex/shared';

/**
 * Pure CI helpers behind the PR chip: how GitHub's check states fold into the
 * six buckets the chip knows, how buckets fold into one status, and in which
 * order the checks are listed.
 */

const BUCKET_BY_STATE: Record<string, PrCiBucket> = {
  // CheckRun status (not completed yet)
  QUEUED: 'pending',
  PENDING: 'pending',
  WAITING: 'pending',
  REQUESTED: 'pending',
  IN_PROGRESS: 'running',
  // CheckRun conclusion
  SUCCESS: 'pass',
  NEUTRAL: 'skip',
  SKIPPED: 'skip',
  STALE: 'skip',
  // A completed run with no conclusion counts as nothing to act on.
  COMPLETED: 'skip',
  FAILURE: 'fail',
  TIMED_OUT: 'fail',
  STARTUP_FAILURE: 'fail',
  ACTION_REQUIRED: 'fail',
  CANCELLED: 'cancel',
  // StatusContext state (SUCCESS / PENDING / FAILURE shared with the above)
  EXPECTED: 'pending',
  ERROR: 'fail',
};

/**
 * Maps one GitHub state to its bucket. Covers CheckRun statuses and
 * conclusions, StatusContext states and the `CheckRunState` keys of
 * `checkRunCountsByState` (a mix of both). An unknown state is reported as
 * `pending`: it neither hides a failure nor claims a pass.
 */
export function toCiBucket(state: string | null | undefined): PrCiBucket {
  return (state && BUCKET_BY_STATE[state]) || 'pending';
}

/** A CheckRun node's bucket: its status while it isn't done, its conclusion after. */
export function checkRunBucket(status: string, conclusion: string | null): PrCiBucket {
  return status === 'COMPLETED' ? toCiBucket(conclusion ?? 'NEUTRAL') : toCiBucket(status);
}

/**
 * The chip's single status. Any failure wins over anything still running, so
 * a red dot shows as soon as one job fails.
 */
export function aggregateCiStatus(counts: Partial<Record<PrCiBucket, number>>): PrCiStatus {
  const n = (b: PrCiBucket) => counts[b] ?? 0;
  const total = n('pass') + n('fail') + n('pending') + n('running') + n('cancel') + n('skip');
  if (total === 0) return 'none';
  if (n('fail') + n('cancel') > 0) return 'failed';
  if (n('pending') + n('running') > 0) return 'running';
  return 'passed';
}

const BUCKET_ORDER: Record<PrCiBucket, number> = {
  fail: 0, running: 1, pending: 2, cancel: 3, pass: 4, skip: 5,
};

/** What needs attention first: failed → running → pending → cancelled → passed → skipped, then by name. */
export function sortChecks(checks: PrCheck[]): PrCheck[] {
  return [...checks].sort((a, b) =>
    BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || a.name.localeCompare(b.name));
}

/** Adds up `{ state, count }` rows (from `*CountsByState`) into bucket counts. */
export function countsFromStates(
  rows: { state: string; count: number }[],
  into: Partial<Record<PrCiBucket, number>> = {},
): Partial<Record<PrCiBucket, number>> {
  for (const { state, count } of rows) {
    if (!count) continue;
    const bucket = toCiBucket(state);
    into[bucket] = (into[bucket] ?? 0) + count;
  }
  return into;
}

/** The repository's allowed merge methods, its default first when that one is allowed. */
export function allowedMergeMethods(repo: {
  mergeCommitAllowed: boolean;
  squashMergeAllowed: boolean;
  rebaseMergeAllowed: boolean;
  viewerDefaultMergeMethod?: string | null;
}): PrMergeMethod[] {
  const allowed: PrMergeMethod[] = [];
  if (repo.mergeCommitAllowed) allowed.push('merge');
  if (repo.squashMergeAllowed) allowed.push('squash');
  if (repo.rebaseMergeAllowed) allowed.push('rebase');
  const preferred = repo.viewerDefaultMergeMethod?.toLowerCase() as PrMergeMethod | undefined;
  if (preferred && allowed.includes(preferred)) {
    return [preferred, ...allowed.filter((m) => m !== preferred)];
  }
  return allowed;
}
