import { useEffect, useState } from 'react';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { DashboardHeader } from './DashboardHeader';
import { IssuesBanner } from './IssuesBanner';
import { PullRequestsSection } from './PullRequestsSection';
import { MergedPRsSection } from './MergedPRsSection';
import { WorktreesSection } from './WorktreesSection';
import { cn } from '../../lib/cn';

type Tab = 'pulls' | 'issues' | 'worktrees' | 'merged';

interface Props {
  repoKey: string;
}

export function RepositoryDashboard({ repoKey }: Props) {
  const [org, name] = repoKey.split('/');
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);
  const dashboardData = useRepositoryDashboardStore((s) => s.dashboardData);
  const githubUser = useRepositoryDashboardStore((s) => s.githubUser);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('pulls');

  useEffect(() => {
    if (!org || !name) return;

    setLoading(true);
    fetchDashboard(org, name).finally(() => setLoading(false));
  }, [org, name, fetchDashboard]);

  const isCurrentRepo = dashboardData?.org === org && dashboardData?.name === name;
  const data = isCurrentRepo ? dashboardData : null;
  const isLoading = loading && !data;

  const openPRs = data?.openPullRequests ?? [];
  const issues = data?.openIssues ?? [];
  const worktrees = (data?.worktrees ?? []).filter((wt) => !wt.isBare);
  const mergedPRs = data?.recentlyMergedPullRequests ?? [];

  if (!org || !name) return null;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'pulls', label: 'Pull Requests', count: openPRs.length },
    { key: 'issues', label: 'Issues', count: issues.length },
    { key: 'worktrees', label: 'Worktrees', count: worktrees.length },
    { key: 'merged', label: 'Merged', count: mergedPRs.length },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader org={org} name={name} />
      {data?.isClonedLocally === false && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <circle cx="8" cy="8" r="6" />
            <line x1="8" y1="5" x2="8" y2="8.5" />
            <circle cx="8" cy="11" r="0.5" fill="currentColor" />
          </svg>
          This repository is not cloned locally. Worktree and diff data is unavailable.
        </div>
      )}
      <div className="flex items-center gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap transition-colors',
              activeTab === tab.key
                ? 'text-[var(--theme-text-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                activeTab === tab.key
                  ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'
                  : 'bg-[var(--theme-bg-surface)] text-[var(--theme-text-muted)]',
              )}
            >
              {tab.count}
            </span>
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'pulls' && (
          <PullRequestsSection
            org={org}
            name={name}
            pullRequests={openPRs}
            diffStats={data?.diffStats ?? {}}
            githubUser={githubUser}
            worktrees={data?.worktrees ?? []}
            loading={isLoading}
          />
        )}
        {activeTab === 'issues' && (
          <IssuesBanner
            org={org}
            name={name}
            issues={issues}
            loading={isLoading}
          />
        )}
        {activeTab === 'worktrees' && (
          <WorktreesSection
            org={org}
            name={name}
            worktrees={data?.worktrees ?? []}
            diffStats={data?.diffStats ?? {}}
            openPullRequests={openPRs}
            mergedPullRequests={mergedPRs}
            loading={isLoading}
          />
        )}
        {activeTab === 'merged' && (
          <MergedPRsSection
            org={org}
            name={name}
            mergedPRs={mergedPRs}
            loading={isLoading}
          />
        )}
      </div>
    </div>
  );
}
