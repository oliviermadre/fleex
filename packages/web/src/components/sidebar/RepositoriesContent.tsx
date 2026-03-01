import { useMemo } from 'react';
import type { RepositorySummary } from '@asm/shared';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { RepositoriesSidebarHeader } from './RepositoriesSidebarHeader';
import { OrgGroup } from './OrgGroup';

export function RepositoriesContent() {
  const summaries = useRepositoryDashboardStore((s) => s.summaries);

  const orgGroups = useMemo(() => {
    const groups = new Map<string, RepositorySummary[]>();
    for (const summary of Object.values(summaries)) {
      const existing = groups.get(summary.org) ?? [];
      existing.push(summary);
      groups.set(summary.org, existing);
    }
    // Sort repos by name within each org, then sort orgs alphabetically
    for (const [, repos] of groups) {
      repos.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [summaries]);

  return (
    <>
      <RepositoriesSidebarHeader />
      <div className="flex-1 overflow-y-auto pb-2">
        {orgGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-[var(--theme-text-muted)]">
            <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--theme-text-faint)]">
              <circle cx="5" cy="3.5" r="1.5" />
              <circle cx="11" cy="3.5" r="1.5" />
              <circle cx="8" cy="12.5" r="1.5" />
              <line x1="5" y1="5" x2="5" y2="7" />
              <line x1="11" y1="5" x2="11" y2="7" />
              <path d="M5 7c0 1.5 1.5 2.5 3 4M11 7c0 1.5-1.5 2.5-3 4" />
            </svg>
            <p className="text-xs">No repositories configured</p>
            <p className="text-[10px] text-[var(--theme-text-faint)]">Configure repositories in Settings</p>
          </div>
        ) : (
          orgGroups.map(([org, repos]) => (
            <OrgGroup
              key={org}
              org={org}
              repos={repos}
            />
          ))
        )}
      </div>
    </>
  );
}
