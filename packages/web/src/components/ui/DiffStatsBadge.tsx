import type { DiffStats } from '@asm/shared';
import { cn } from '../../lib/cn';

interface DiffStatsBadgeProps {
  stats: DiffStats | null | undefined;
  loading?: boolean;
}

export function DiffStatsBadge({ stats, loading }: DiffStatsBadgeProps) {
  if (loading) {
    return (
      <span className="inline-flex gap-2">
        <span className="inline-block h-4 w-12 animate-pulse rounded bg-zinc-700/50" />
        <span className="inline-block h-4 w-14 animate-pulse rounded bg-zinc-700/50" />
      </span>
    );
  }

  if (!stats) {
    return <span className="text-zinc-500">&mdash;</span>;
  }

  return (
    <span className="inline-flex gap-2 text-xs font-mono whitespace-nowrap">
      <span className="inline-flex gap-1">
        <span className={cn(stats.commitsAhead > 0 ? 'text-emerald-400' : 'text-zinc-500')}>
          &uarr;{stats.commitsAhead}
        </span>
        <span className={cn(stats.commitsBehind > 0 ? 'text-red-400' : 'text-zinc-500')}>
          &darr;{stats.commitsBehind}
        </span>
      </span>
      <span className="inline-flex gap-1">
        <span className={cn(stats.additions > 0 ? 'text-emerald-400' : 'text-zinc-500')}>
          +{stats.additions}
        </span>
        <span className={cn(stats.deletions > 0 ? 'text-red-400' : 'text-zinc-500')}>
          -{stats.deletions}
        </span>
      </span>
    </span>
  );
}
