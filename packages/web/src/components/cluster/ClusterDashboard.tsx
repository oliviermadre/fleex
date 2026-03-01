import { useState, useCallback } from 'react';
import { cn } from '../../lib/cn';

const TILT_URL = 'http://localhost:10350';

export function ClusterDashboard() {
  const [iframeKey, setIframeKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setIframeKey((k) => k + 1);
    // Brief visual feedback
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-[var(--theme-border)] px-3"
        style={{ height: 'var(--header-height)' }}
      >
        <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)]">Tilt</span>
        <button
          className={cn(
            'flex items-center justify-center rounded p-1 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
            refreshing && 'text-[var(--theme-accent)]',
          )}
          onClick={handleRefresh}
          title="Refresh"
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
            className={cn(refreshing && 'animate-spin')}
          >
            <path d="M2 8a6 6 0 0 1 10.3-4.2" />
            <polyline points="13,1 13,5 9,5" />
            <path d="M14 8a6 6 0 0 1-10.3 4.2" />
            <polyline points="3,15 3,11 7,11" />
          </svg>
        </button>
      </div>

      {/* Tilt iframe */}
      <iframe
        key={iframeKey}
        src={TILT_URL}
        title="Tilt Dashboard"
        className="flex-1 border-0"
        style={{ width: '100%', height: '100%' }}
        allow="fullscreen"
      />
    </div>
  );
}
