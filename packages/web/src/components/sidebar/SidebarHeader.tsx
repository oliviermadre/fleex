import { useState, useCallback } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { useClaudeUsage } from '../../hooks/useClaudeUsage';
import { UsageGauges } from './UsageGauges';
import { RefreshCwIcon } from './icons';

export function SidebarHeader() {
  const sessions = useSessionStore((s) => s.sessions);
  const refreshAllPulls = usePullRequestStore((s) => s.refreshAllPulls);
  const { usage, loading, refresh: refreshUsage } = useClaudeUsage();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([refreshAllPulls(), refreshUsage()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, refreshAllPulls, refreshUsage]);

  return (
    <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--theme-text-primary)]">Sessions</span>
        <span className="rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-secondary)]">
          {sessions.length}
        </span>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
          title="Refresh usage & PRs"
        >
          <RefreshCwIcon
            size={11}
            className={refreshing ? 'animate-spin' : ''}
          />
        </button>
      </div>
      <UsageGauges usage={usage} loading={loading} />
    </div>
  );
}
