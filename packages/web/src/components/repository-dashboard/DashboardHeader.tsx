import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { RefreshControl } from '../ui/RefreshControl';
import { GitHubIcon } from '../sidebar/icons';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';

interface Props {
  org: string;
  name: string;
  worktreeCount: number;
  isCloned: boolean;
}

export function DashboardHeader({ org, name, worktreeCount, isCloned }: Props) {
  const refreshing = useRepositoryDashboardStore((s) => s.refreshing);
  const requestRefresh = useRepositoryDashboardStore((s) => s.requestRefresh);
  const refreshIntervalMs = useRepositoryDashboardStore((s) => s.refreshIntervalMs);
  const setRefreshInterval = useRepositoryDashboardStore((s) => s.setRefreshInterval);
  const lastRefreshedAt = useRepositoryDashboardStore((s) => s.lastRefreshedAt);
  const rateLimitWarning = useRepositoryDashboardStore((s) => s.rateLimitWarning);

  return (
    <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold font-mono text-[var(--theme-text-primary)]">
          {org}/{name}
        </h1>
        <a
          href={`https://github.com/${org}/${name}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
        >
          <GitHubIcon size={14} />
        </a>
        {isCloned ? (
          <span className={cn('rounded-full px-2 py-0.5 text-[10.5px]', tint('green'))}>
            cloned · {worktreeCount} worktrees
          </span>
        ) : (
          <span className={cn('rounded-full px-2 py-0.5 text-[10.5px]', tint('yellow'))}>
            not cloned
          </span>
        )}
      </div>
      <RefreshControl
        refreshing={refreshing}
        onRefresh={() => requestRefresh('repo', org, name)}
        refreshIntervalMs={refreshIntervalMs}
        onIntervalChange={setRefreshInterval}
        lastRefreshedAt={lastRefreshedAt}
        rateLimitWarning={rateLimitWarning}
      />
    </div>
  );
}
