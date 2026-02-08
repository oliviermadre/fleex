import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { RefreshControl } from '../ui/RefreshControl';

export function RepositoriesSidebarHeader() {
  const refreshing = useRepositoryDashboardStore((s) => s.refreshing);
  const requestRefresh = useRepositoryDashboardStore((s) => s.requestRefresh);
  const refreshIntervalMs = useRepositoryDashboardStore((s) => s.refreshIntervalMs);
  const setRefreshInterval = useRepositoryDashboardStore((s) => s.setRefreshInterval);
  const lastRefreshedAt = useRepositoryDashboardStore((s) => s.lastRefreshedAt);
  const rateLimitWarning = useRepositoryDashboardStore((s) => s.rateLimitWarning);
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const repoCount = Object.keys(summaries).length;

  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-4" style={{ height: 'var(--header-height)' }}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-zinc-200">Repositories</span>
        <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          {repoCount}
        </span>
      </div>
      <RefreshControl
        refreshing={refreshing}
        onRefresh={() => requestRefresh('all')}
        refreshIntervalMs={refreshIntervalMs}
        onIntervalChange={setRefreshInterval}
        lastRefreshedAt={lastRefreshedAt}
        rateLimitWarning={rateLimitWarning}
        compact
      />
    </div>
  );
}
