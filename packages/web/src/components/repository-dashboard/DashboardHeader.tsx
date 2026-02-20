import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { RefreshControl } from '../ui/RefreshControl';
import { GitHubIcon } from '../sidebar/icons';

interface Props {
  org: string;
  name: string;
}

export function DashboardHeader({ org, name }: Props) {
  const refreshing = useRepositoryDashboardStore((s) => s.refreshing);
  const requestRefresh = useRepositoryDashboardStore((s) => s.requestRefresh);
  const refreshIntervalMs = useRepositoryDashboardStore((s) => s.refreshIntervalMs);
  const setRefreshInterval = useRepositoryDashboardStore((s) => s.setRefreshInterval);
  const lastRefreshedAt = useRepositoryDashboardStore((s) => s.lastRefreshedAt);
  const rateLimitWarning = useRepositoryDashboardStore((s) => s.rateLimitWarning);

  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-6" style={{ height: 'var(--header-height)' }}>
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold text-zinc-200">
          {org}/{name}
        </h1>
        <a
          href={`https://github.com/${org}/${name}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-500 hover:text-zinc-300"
        >
          <GitHubIcon size={14} />
        </a>
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
