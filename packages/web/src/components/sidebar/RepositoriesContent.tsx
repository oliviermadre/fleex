import { useCallback, useMemo, useState } from 'react';
import type { RepositorySummary } from '@fleex/shared';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { RepositoriesSidebarHeader } from './RepositoriesSidebarHeader';
import { OrgGroup } from './OrgGroup';
import { RepoItem } from './RepoItem';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AddRepositoriesModal } from '../repositories/AddRepositoriesModal';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

type Filter = 'all' | 'active' | string;

export function RepositoriesContent() {
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const removeRepository = useSettingsStore((s) => s.removeRepository);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const wtCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of sessionGroups) {
      counts[`${g.repositoryOrg}/${g.repositoryName}`] = g.worktrees.length;
    }
    return counts;
  }, [sessionGroups]);

  const activeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const g of sessionGroups) {
      if (g.worktrees.length > 0 || g.worktrees.some((w) => w.sessions.length > 0)) {
        keys.add(`${g.repositoryOrg}/${g.repositoryName}`);
      }
    }
    return keys;
  }, [sessionGroups]);

  const allSummaries = useMemo(() => Object.values(summaries), [summaries]);

  const orgs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of allSummaries) {
      counts.set(s.org, (counts.get(s.org) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [allSummaries]);

  const normalizedQuery = query.trim().toLowerCase();
  const showActiveSection = normalizedQuery === '' && filter === 'all';

  const filtered = useMemo(() => {
    return allSummaries.filter((summary) => {
      const key = `${summary.org}/${summary.name}`;
      if (normalizedQuery) {
        const haystack = `${summary.name} ${key}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      if (filter === 'active') return activeKeys.has(key);
      if (filter !== 'all') return summary.org === filter;
      return true;
    });
  }, [allSummaries, normalizedQuery, filter, activeKeys]);

  const orgGroups = useMemo(() => {
    const groups = new Map<string, RepositorySummary[]>();
    for (const summary of filtered) {
      const existing = groups.get(summary.org) ?? [];
      existing.push(summary);
      groups.set(summary.org, existing);
    }
    for (const [, repos] of groups) {
      repos.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    }
    return [...groups.entries()].sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [filtered]);

  const activeRepos = useMemo(() => {
    if (!showActiveSection) return [];
    return allSummaries
      .filter((summary) => activeKeys.has(`${summary.org}/${summary.name}`))
      .sort((a, b) => `${a.org}/${a.name}`.toLowerCase().localeCompare(`${b.org}/${b.name}`.toLowerCase()));
  }, [allSummaries, activeKeys, showActiveSection]);

  const handleRemove = useCallback((key: string) => setPendingRemove(key), []);

  return (
    <>
      <RepositoriesSidebarHeader onAdd={() => setModalOpen(true)} />
      <div className="px-3 pt-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)]">
            <SearchIcon />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search repositories…"
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] py-2 pl-7 pr-3 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 py-2">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All {allSummaries.length}
        </FilterChip>
        <FilterChip active={filter === 'active'} onClick={() => setFilter('active')}>
          Active {activeKeys.size}
        </FilterChip>
        {orgs.map(([org, count]) => (
          <FilterChip key={org} active={filter === org} onClick={() => setFilter(org)}>
            {org} {count}
          </FilterChip>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto pb-2">
        {allSummaries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-[var(--theme-border)] text-[var(--theme-text-faint)]">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13" />
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
            </div>
            <p className="text-xs text-[var(--theme-text-muted)]">No repositories tracked yet</p>
            <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>+ Add repositories</Button>
          </div>
        ) : orgGroups.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-[var(--theme-text-muted)]">No repos match</p>
        ) : (
          <>
            {showActiveSection && activeRepos.length > 0 && (
              <>
                <div className={cn('px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider', tintText('yellow'))}>Active</div>
                {activeRepos.map((repo) => (
                  <RepoItem
                    key={`active-${repo.org}/${repo.name}`}
                    summary={repo}
                    wtCount={wtCounts[`${repo.org}/${repo.name}`] ?? 0}
                    onRemove={handleRemove}
                  />
                ))}
              </>
            )}
            {orgGroups.map(([org, repos]) => (
              <OrgGroup key={org} org={org} repos={repos} wtCounts={wtCounts} onRemove={handleRemove} />
            ))}
          </>
        )}
      </div>
      <ConfirmModal
        open={pendingRemove !== null}
        busy={removing}
        title="Stop tracking repository"
        message={<span>Remove <span className="font-mono">{pendingRemove}</span> from tracked repositories? Its local bare clone will be cleaned up.</span>}
        confirmLabel="Remove"
        onCancel={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (!pendingRemove) return;
          setRemoving(true);
          try {
            await removeRepository(pendingRemove);
          } finally {
            setRemoving(false);
            setPendingRemove(null);
          }
        }}
      />
      <AddRepositoriesModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-0.5 text-[11px]',
        active
          ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
          : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
      )}
    >
      {children}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="5" />
      <path d="m14 14-3.5-3.5" />
    </svg>
  );
}
