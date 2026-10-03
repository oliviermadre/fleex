/**
 * Live CI and mergeability of a GitHub pull request, as shown by the PR chip.
 * Never persisted: always fetched from GitHub on demand.
 */

/** Where a single check stands, normalised across CheckRuns and StatusContexts. */
export type PrCiBucket = 'pass' | 'fail' | 'pending' | 'running' | 'cancel' | 'skip';

/** The one status a chip shows for all of a PR's checks. */
export type PrCiStatus = 'none' | 'running' | 'failed' | 'passed';

export type PrMergeMethod = 'merge' | 'squash' | 'rebase';

export const PR_MERGE_METHODS: readonly PrMergeMethod[] = ['merge', 'squash', 'rebase'];

/** Light and bulk-friendly: one per chip on screen. */
export interface PrCiSummary {
  /** "org/name#123", lowercase (same as TicketLink.ref). */
  ref: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  ciStatus: PrCiStatus;
  counts: Partial<Record<PrCiBucket, number>>;
}

export interface PrCheck {
  name: string;
  bucket: PrCiBucket;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export type PrMergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
export type PrMergeStateStatus =
  | 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE';

/** Heavy, on demand: fetched when a chip's menu opens. */
export interface PrCiDetail extends PrCiSummary {
  url: string;
  title: string;
  baseRefName: string;
  headSha: string;
  /** Sorted failed → running → pending → cancelled → passed → skipped, then by name. At most 100. */
  checks: PrCheck[];
  /** Every check on the head commit, which can exceed `checks.length`. */
  totalChecks: number;
  mergeable: PrMergeable;
  mergeStateStatus: PrMergeStateStatus;
  /** The methods the repository allows, its default first. */
  allowedMergeMethods: PrMergeMethod[];
}

export interface MergePrRequest {
  ref: string;
  method: PrMergeMethod;
  headSha: string;
}
