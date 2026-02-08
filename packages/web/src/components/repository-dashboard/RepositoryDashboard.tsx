import { useEffect, useState } from 'react';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { DashboardHeader } from './DashboardHeader';
import { IssuesSection } from './IssuesSection';
import { PullRequestsSection } from './PullRequestsSection';
import { MergedPRsSection } from './MergedPRsSection';
import { WorktreesSection } from './WorktreesSection';

interface Props {
  repoKey: string;
}

export function RepositoryDashboard({ repoKey }: Props) {
  const [org, name] = repoKey.split('/');
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);
  const dashboardData = useRepositoryDashboardStore((s) => s.dashboardData);
  const githubUser = useRepositoryDashboardStore((s) => s.githubUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!org || !name) return;

    setLoading(true);
    fetchDashboard(org, name).finally(() => setLoading(false));
  }, [org, name, fetchDashboard]);

  const isCurrentRepo = dashboardData?.org === org && dashboardData?.name === name;
  const data = isCurrentRepo ? dashboardData : null;

  if (!org || !name) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader org={org} name={name} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-4">
          <IssuesSection
            org={org}
            name={name}
            issues={data?.openIssues ?? []}
            loading={loading && !data}
          />
          <PullRequestsSection
            org={org}
            name={name}
            pullRequests={data?.openPullRequests ?? []}
            diffStats={data?.diffStats ?? {}}
            githubUser={githubUser}
            loading={loading && !data}
          />
          <MergedPRsSection
            org={org}
            name={name}
            mergedPRs={data?.recentlyMergedPullRequests ?? []}
            loading={loading && !data}
          />
          <WorktreesSection
            org={org}
            name={name}
            worktrees={data?.worktrees ?? []}
            diffStats={data?.diffStats ?? {}}
            loading={loading && !data}
          />
        </div>
      </div>
    </div>
  );
}
