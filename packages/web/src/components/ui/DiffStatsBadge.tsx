import type { DiffStats } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

interface DiffStatsBadgeProps {
  stats: DiffStats | null | undefined;
  loading?: boolean;
}

export function DiffStatsBadge({ stats, loading }: DiffStatsBadgeProps) {
  if (loading) {
    return (
      <span className="inline-flex gap-2">
        <span className="inline-block h-4 w-12 animate-pulse rounded bg-[var(--theme-border-input)]" />
        <span className="inline-block h-4 w-14 animate-pulse rounded bg-[var(--theme-border-input)]" />
      </span>
    );
  }

  if (!stats) {
    return <span className="text-[var(--theme-text-muted)]">&mdash;</span>;
  }

  return (
    <span className="inline-flex gap-2 text-xs font-mono whitespace-nowrap">
      <span className="inline-flex gap-1">
        <span className={cn(stats.commitsAhead > 0 ? tintText('green') : 'text-[var(--theme-text-muted)]')}>
          &uarr;{stats.commitsAhead}
        </span>
        <span className={cn(stats.commitsBehind > 0 ? tintText('red') : 'text-[var(--theme-text-muted)]')}>
          &darr;{stats.commitsBehind}
        </span>
      </span>
      <span className="inline-flex gap-1">
        <span className={cn(stats.additions > 0 ? tintText('green') : 'text-[var(--theme-text-muted)]')}>
          +{stats.additions}
        </span>
        <span className={cn(stats.deletions > 0 ? tintText('red') : 'text-[var(--theme-text-muted)]')}>
          -{stats.deletions}
        </span>
      </span>
    </span>
  );
}
