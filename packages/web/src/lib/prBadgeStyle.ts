import type { PullRequest } from '@fleex/shared';

export function getPrBadgeClasses(pr: Pick<PullRequest, 'state' | 'isDraft'>): string {
  if (pr.isDraft) {
    return 'bg-zinc-500/15 text-zinc-400 hover:bg-zinc-500 hover:text-white';
  }
  switch (pr.state) {
    case 'merged':
      return 'bg-purple-500/15 text-purple-400 hover:bg-purple-500 hover:text-white';
    case 'closed':
      return 'bg-red-500/15 text-red-400 hover:bg-red-500 hover:text-white';
    case 'open':
    default:
      return 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500 hover:text-white';
  }
}
