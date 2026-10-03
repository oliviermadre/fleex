import type { PrCheck, PrCiBucket, PrCiDetail, PrCiStatus, PrMergeMethod } from '@fleex/shared';
import type { TintHue } from './tints';

/** What the chip's CI segment shows: GitHub's aggregated status, or where its fetch stands. */
export type ChipCiStatus = PrCiStatus | 'loading' | 'error';

const LABELS: Record<ChipCiStatus, string> = {
  loading: 'CI …',
  none: 'No CI',
  running: 'CI running',
  failed: 'CI failed',
  passed: 'CI passed',
  error: 'CI ?',
};

export function ciLabel(status: ChipCiStatus): string {
  return LABELS[status];
}

const HUES: Record<ChipCiStatus, TintHue> = {
  loading: 'gray',
  none: 'gray',
  running: 'yellow',
  failed: 'red',
  passed: 'green',
  error: 'gray',
};

export function ciHue(status: ChipCiStatus): TintHue {
  return HUES[status];
}

export const BUCKET_HUE: Record<PrCiBucket, TintHue> = {
  fail: 'red', running: 'yellow', pending: 'yellow', cancel: 'gray', pass: 'green', skip: 'gray',
};

const COUNT_ORDER: [PrCiBucket, string][] = [
  ['pass', 'passed'], ['fail', 'failed'], ['running', 'running'], ['pending', 'pending'], ['cancel', 'cancelled'], ['skip', 'skipped'],
];

/** "3 passed · 1 failed · 2 running" — empty buckets left out. */
export function ciTooltip(counts: Partial<Record<PrCiBucket, number>>): string {
  return COUNT_ORDER
    .filter(([bucket]) => (counts[bucket] ?? 0) > 0)
    .map(([bucket, word]) => `${counts[bucket]} ${word}`)
    .join(' · ');
}

const METHOD_LABELS: Record<PrMergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create a merge commit',
  rebase: 'Rebase and merge',
};

export function mergeMethodLabel(method: PrMergeMethod): string {
  return METHOD_LABELS[method];
}

/** Why the merge buttons are off (`blocked`), or a heads-up while they're on (UNSTABLE). */
export interface MergeAvailability {
  blocked: boolean;
  message: string | null;
}

/**
 * Whether the menu lets you merge, from GitHub's own mergeability fields.
 * First matching rule wins; GitHub stays the final judge (gh's refusal is
 * shown in the dialog anyway).
 */
export function mergeBlockReason(
  detail: Pick<PrCiDetail, 'isDraft' | 'mergeable' | 'mergeStateStatus'>,
): MergeAvailability {
  const { isDraft, mergeable, mergeStateStatus: status } = detail;
  if (isDraft || status === 'DRAFT') return { blocked: true, message: 'Draft PR — mark as ready on GitHub first' };
  if (mergeable === 'CONFLICTING' || status === 'DIRTY') return { blocked: true, message: 'Merge conflicts' };
  if (status === 'BEHIND') return { blocked: true, message: 'Branch is behind base — update it on GitHub' };
  if (status === 'BLOCKED') return { blocked: true, message: 'Blocked by branch protection (reviews or required checks)' };
  if (mergeable === 'UNKNOWN' || status === 'UNKNOWN') return { blocked: true, message: 'Checking mergeability…' };
  if (status === 'UNSTABLE') return { blocked: false, message: 'Some non-required checks failed' };
  return { blocked: false, message: null };
}

/** "2m 14s" for a finished check, "running"/"pending" while it isn't, "" when GitHub gave no times. */
export function formatCheckDuration(check: Pick<PrCheck, 'bucket' | 'startedAt' | 'completedAt'>): string {
  if (check.bucket === 'running') return 'running';
  if (check.bucket === 'pending') return 'pending';
  if (!check.startedAt || !check.completedAt) return '';
  const ms = Date.parse(check.completedAt) - Date.parse(check.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** One PR of a group as its chip shows it: GitHub state, and CI while open. */
export interface PrGroupEntry {
  state: 'open' | 'merged' | 'closed';
  ci: ChipCiStatus;
}

/** What the summary chip's dot shows: the worst CI among open PRs, else the worst state. */
export type PrGroupWorst = { kind: 'ci'; status: ChipCiStatus } | { kind: 'state'; state: 'merged' | 'closed' };

/** Worst first: a failing PR must never hide behind a passing one. */
const CI_SEVERITY: ChipCiStatus[] = ['failed', 'error', 'running', 'loading', 'passed', 'none'];

export function worstPrStatus(entries: PrGroupEntry[]): PrGroupWorst | null {
  const open = entries.filter((e) => e.state === 'open');
  if (open.length > 0) {
    const status = CI_SEVERITY.find((s) => open.some((e) => e.ci === s)) ?? 'none';
    return { kind: 'ci', status };
  }
  if (entries.some((e) => e.state === 'closed')) return { kind: 'state', state: 'closed' };
  if (entries.length > 0) return { kind: 'state', state: 'merged' };
  return null;
}

/** "6 PR — 1 CI failed · 2 CI running · 3 merged": worst first. */
export function prGroupTooltip(entries: PrGroupEntry[]): string {
  const labels = [
    ...CI_SEVERITY.map((s) => [ciLabel(s), entries.filter((e) => e.state === 'open' && e.ci === s).length] as const),
    ['merged', entries.filter((e) => e.state === 'merged').length] as const,
    ['closed', entries.filter((e) => e.state === 'closed').length] as const,
  ];
  const parts = labels.filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`);
  return [`${entries.length} PR`, parts.join(' · ')].filter(Boolean).join(' — ');
}
