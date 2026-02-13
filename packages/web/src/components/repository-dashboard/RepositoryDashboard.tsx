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
      <div className="flex items-center gap-1 border-b border-zinc-800 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors',
              activeTab === tab.key
                ? 'text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300',
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                activeTab === tab.key
                  ? 'bg-zinc-600 text-zinc-200'
                  : 'bg-zinc-800 text-zinc-500',
              )}
            >
              {tab.count}
            </span>
            {activeTab === tab.key && (
              <span className="absolute inset-x-0 -bottom-px h-px bg-zinc-400" />
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
