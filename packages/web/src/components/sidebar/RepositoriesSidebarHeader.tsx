import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { useUIStore } from '../../stores/uiStore';
import { RefreshControl } from '../ui/RefreshControl';

interface Props {
  onAdd: () => void;
}

export function RepositoriesSidebarHeader({ onAdd }: Props) {
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);
  const refreshing = useRepositoryDashboardStore((s) => s.refreshing);
  const requestRefresh = useRepositoryDashboardStore((s) => s.requestRefresh);
  const refreshIntervalMs = useRepositoryDashboardStore((s) => s.refreshIntervalMs);
  const setRefreshInterval = useRepositoryDashboardStore((s) => s.setRefreshInterval);
  const lastRefreshedAt = useRepositoryDashboardStore((s) => s.lastRefreshedAt);
  const rateLimitWarning = useRepositoryDashboardStore((s) => s.rateLimitWarning);
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const repoCount = Object.keys(summaries).length;

  return (
    <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Repositories</span>
        <span className="rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
          {repoCount}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onAdd}
          title="Add repositories"
          className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] hover:opacity-90"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
        </button>
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => requestRefresh('all')}
          refreshIntervalMs={refreshIntervalMs}
          onIntervalChange={setRefreshInterval}
          lastRefreshedAt={lastRefreshedAt}
          rateLimitWarning={rateLimitWarning}
          compact
        />
        <button
          onClick={toggleContentPanel}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          title="Collapse panel"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
            <line x1="6" y1="1.5" x2="6" y2="14.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
