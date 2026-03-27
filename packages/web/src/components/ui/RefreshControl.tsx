import { useState, useEffect, useRef, useCallback } from 'react';
import { REPO_REFRESH_INTERVALS, REPO_REFRESH_LABELS } from '@fleex/shared';
import { cn } from '../../lib/cn';

interface RefreshControlProps {
  refreshing: boolean;
  onRefresh: () => void;
  refreshIntervalMs: number;
  onIntervalChange: (ms: number) => void;
  lastRefreshedAt: string | null;
  rateLimitWarning: { remaining: number; resetAt: string } | null;
  compact?: boolean;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function RefreshControl({
  refreshing,
  onRefresh,
  refreshIntervalMs,
  onIntervalChange,
  lastRefreshedAt,
  rateLimitWarning,
  compact = false,
}: RefreshControlProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [timeAgo, setTimeAgo] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lastRefreshedAt) return;
    setTimeAgo(formatTimeAgo(lastRefreshedAt));
    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(lastRefreshedAt));
    }, 30_000);
    return () => clearInterval(interval);
  }, [lastRefreshedAt]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const handleIntervalSelect = useCallback((ms: number) => {
    onIntervalChange(ms);
    setDropdownOpen(false);
  }, [onIntervalChange]);

  return (
    <div className="flex items-center gap-2">
      {/* Refresh button */}
      <button
        className={cn(
          'flex items-center justify-center rounded p-1 text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]',
          refreshing && 'text-[var(--theme-accent)]',
        )}
        onClick={onRefresh}
        disabled={refreshing}
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

      {/* Rate limit warning */}
      {rateLimitWarning && rateLimitWarning.remaining < 500 && (
        <span className="h-2 w-2 rounded-full bg-yellow-500" title={`Rate limit: ${rateLimitWarning.remaining} remaining`} />
      )}

      {/* Auto-refresh dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-secondary)]"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          {refreshIntervalMs > 0
            ? REPO_REFRESH_LABELS[refreshIntervalMs] ?? `${refreshIntervalMs / 1000}s`
            : 'Auto'}
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
            <path d="M2 3l2 2.5L6 3H2z" />
          </svg>
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-lg">
            {REPO_REFRESH_INTERVALS.map((ms: number) => (
              <button
                key={ms}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-[var(--theme-bg-overlay)]',
                  ms === refreshIntervalMs ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)]',
                )}
                onClick={() => handleIntervalSelect(ms)}
              >
                <span>{REPO_REFRESH_LABELS[ms]}</span>
                {ms === refreshIntervalMs && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M1.5 5.5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Last refreshed */}
      {!compact && lastRefreshedAt && (
        <span className="text-[10px] text-[var(--theme-text-faint)]">{timeAgo}</span>
      )}
    </div>
  );
}
