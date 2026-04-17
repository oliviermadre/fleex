import { useEffect, useCallback, useRef } from 'react';
import { useExecutionLogStore, type ExecutionTypeFilter } from '../../stores/executionLogStore';
import { appWs } from '../../services/websocket';
import { ExecutionRow } from './ExecutionRow';
import { cn } from '../../lib/cn';

// ── Filter tab icons (SVG, matching sidebar) ──

function AgentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SkillIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
      <path d="M7 8l3 3-3 3" /><path d="M13 14h3" />
    </svg>
  );
}

const TYPE_FILTERS: { key: ExecutionTypeFilter; label: string; icon: React.ReactNode | null; iconColor: string | null }[] = [
  { key: 'all', label: 'ALL', icon: null, iconColor: null },
  { key: 'agent', label: 'AGENT', icon: <AgentIcon />, iconColor: 'text-indigo-400' },
  { key: 'panel', label: 'PANEL', icon: <PanelIcon />, iconColor: 'text-violet-400' },
  { key: 'skill', label: 'SKILL', icon: <SkillIcon />, iconColor: 'text-cyan-400' },
];

export function ExecutionLogPage() {
  const liveEntries = useExecutionLogStore((s) => s.liveEntries);
  const historyEntries = useExecutionLogStore((s) => s.historyEntries);
  const liveCount = useExecutionLogStore((s) => s.liveCount);
  const historyCount = useExecutionLogStore((s) => s.historyCount);
  const typeCounts = useExecutionLogStore((s) => s.typeCounts);
  const typeFilter = useExecutionLogStore((s) => s.typeFilter);
  const searchQuery = useExecutionLogStore((s) => s.searchQuery);
  const setTypeFilter = useExecutionLogStore((s) => s.setTypeFilter);
  const setSearchQuery = useExecutionLogStore((s) => s.setSearchQuery);
  const load = useExecutionLogStore((s) => s.load);
  const loadMore = useExecutionLogStore((s) => s.loadMore);
  const loaded = useExecutionLogStore((s) => s.loaded);
  const loading = useExecutionLogStore((s) => s.loading);
  const loadingMore = useExecutionLogStore((s) => s.loadingMore);
  const handleWsEvent = useExecutionLogStore((s) => s.handleWsEvent);
  const subscribeAll = useExecutionLogStore((s) => s.subscribeAll);
  const unsubscribeAll = useExecutionLogStore((s) => s.unsubscribeAll);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInitRef = useRef(false);

  useEffect(() => {
    // Subscribe + register on every mount (idempotent via cleanup), so the
    // StrictMode double-mount still ends with exactly one live subscription.
    subscribeAll();
    const unsubAgent = appWs.onChannel('agent-events', (msg) => { handleWsEvent(msg); });
    // Load only once per component instance so StrictMode doesn't fire two
    // identical HTTP fetches on mount.
    if (!didInitRef.current) {
      didInitRef.current = true;
      load();
    }
    return () => { unsubAgent(); unsubscribeAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearchQuery(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { load(); }, 300);
    },
    [setSearchQuery, load],
  );

  const canLoadMore = historyEntries.length < historyCount;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* ── Header ── */}
      <div className="flex-shrink-0 border-b border-[var(--theme-border)] px-6 py-5">
        {/* Title row */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-emerald-400">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[var(--theme-text-primary)]">Execution Log</h1>
              <p className="text-xs text-[var(--theme-text-muted)]">Live & historical runs of agents, panels and skills</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {liveCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span className="font-medium text-emerald-400">{liveCount} live</span>
              </span>
            )}
            <span className="text-[var(--theme-text-muted)]">·</span>
            <span className="text-[var(--theme-text-muted)]">{historyCount} past</span>
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="relative max-w-md flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--theme-text-faint)]"
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Filter by title, summary or #ticket…"
              className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] py-1.5 pl-9 pr-8 text-sm text-[var(--theme-text-primary)] placeholder-[var(--theme-text-faint)] outline-none focus:border-[var(--theme-accent)]"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); load(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
              </button>
            )}
          </div>

          {/* Type filter tabs */}
          <div className="flex items-center gap-0.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-0.5">
            {TYPE_FILTERS.map(({ key, label, icon, iconColor }) => {
              const count = typeCounts[key] ?? 0;
              const active = typeFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setTypeFilter(key)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)] shadow-sm'
                      : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
                  )}
                >
                  {icon && <span className={iconColor ?? ''}>{icon}</span>}
                  <span>{label}</span>
                  <span className={cn(
                    'ml-0.5 rounded-full px-1.5 text-[10px] font-semibold',
                    active
                      ? 'bg-[var(--theme-accent)] text-white'
                      : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-faint)]',
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        <style dangerouslySetInnerHTML={{ __html: `@keyframes execLogSkeleton { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }` }} />

        {/* Live section */}
        <div className="px-6 pt-5">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            LIVE · {loading ? '…' : liveCount}
          </div>
          {loading ? (
            <SkeletonRows count={2} />
          ) : liveEntries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--theme-border)] bg-[var(--theme-bg-base)] py-8 text-center text-sm text-[var(--theme-text-faint)]">
              No active executions
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {liveEntries.map((entry) => (
                <ExecutionRow key={entry.id} entry={entry} live />
              ))}
            </div>
          )}
        </div>

        {/* History section */}
        <div className="px-6 pb-8 pt-6">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            <span className="h-2 w-2 rounded-full border border-[var(--theme-text-faint)]" />
            HISTORY · {loading ? '…' : historyCount}
            {loaded && historyEntries.length < historyCount && (
              <span className="normal-case tracking-normal text-[var(--theme-text-faint)]">
                (showing {historyEntries.length})
              </span>
            )}
          </div>
          {loading ? (
            <SkeletonRows count={6} />
          ) : historyEntries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--theme-border)] bg-[var(--theme-bg-base)] py-8 text-center text-sm text-[var(--theme-text-faint)]">
              No past executions
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {historyEntries.map((entry) => (
                  <ExecutionRow key={entry.id} entry={entry} live={false} />
                ))}
              </div>
              {canLoadMore && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={() => loadMore()}
                    disabled={loadingMore}
                    className={cn(
                      'rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-4 py-2 text-xs font-medium transition-colors',
                      loadingMore
                        ? 'cursor-not-allowed text-[var(--theme-text-faint)]'
                        : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]',
                    )}
                  >
                    {loadingMore
                      ? 'Loading…'
                      : `Load ${Math.min(100, historyCount - historyEntries.length)} more`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-[52px] rounded-lg border border-[var(--theme-border)]"
          style={{
            background:
              'linear-gradient(90deg, var(--theme-bg-hover) 25%, var(--theme-bg-surface) 50%, var(--theme-bg-hover) 75%)',
            backgroundSize: '200% 100%',
            animation: 'execLogSkeleton 1.5s ease-in-out infinite',
            animationDelay: `${i * 100}ms`,
          }}
        />
      ))}
    </div>
  );
}
