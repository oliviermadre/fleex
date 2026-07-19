import type { PullRequest } from '@fleex/shared';

export type PrSegment = 'all' | 'open' | 'merged';

export function filterPulls(
  open: PullRequest[],
  merged: PullRequest[],
  segment: PrSegment,
  mine: boolean,
  assigned: boolean,
  user: string | null,
): PullRequest[] {
  let base: PullRequest[];
  if (segment === 'open') {
    base = [...open].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } else if (segment === 'merged') {
    base = [...merged].sort((a, b) => (b.mergedAt ?? b.updatedAt).localeCompare(a.mergedAt ?? a.updatedAt));
  } else {
    base = [...open, ...merged].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  if (user && mine) base = base.filter((p) => p.author === user);
  if (user && assigned) base = base.filter((p) => p.assignees.includes(user));
  return base;
}
