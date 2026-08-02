import { useCallback, useState } from 'react';

import { cn } from '../../lib/cn';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { useUIStore } from '../../stores/uiStore';

export function SidebarHeader() {
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);
  const refreshAllPulls = usePullRequestStore((s) => s.refreshAllPulls);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAllPulls();
    } finally {
      setRefreshing(false);
    }
  }, [refreshAllPulls]);

  return (
    <div
      className="flex items-center justify-between border-b border-[var(--theme-border)] px-4"
      style={{ height: 'var(--header-height)' }}
    >
      <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
        Session Tasks
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
            refreshing && 'animate-spin',
          )}
          title="Refresh PR data"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
            <polyline points="13 1 13 4.5 9.5 4.5" />
            <polyline points="3 15 3 11.5 6.5 11.5" />
          </svg>
        </button>
        <button
          onClick={toggleContentPanel}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          title="Collapse panel"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
            <line x1="6" y1="1.5" x2="6" y2="14.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
