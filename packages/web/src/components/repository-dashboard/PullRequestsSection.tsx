import { useState, useMemo } from 'react';
import type { PullRequest, DiffStats } from '@asm/shared';
import { DataTable, type Column } from '../ui/DataTable';
import { DiffStatsBadge } from '../ui/DiffStatsBadge';
import { cn } from '../../lib/cn';

interface Props {
  org: string;
  name: string;
  pullRequests: PullRequest[];
  diffStats: Record<string, DiffStats>;
  githubUser: string | null;
  loading: boolean;
}

type TabFilter = 'all' | 'mine' | 'assigned';

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return `${Math.floor(days / 30)}mo`;
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(diff / 60000);
  return `${minutes}m`;
}

function isStale(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() > 7 * 86400000;
}

export function PullRequestsSection({ org, name, pullRequests, diffStats, githubUser, loading }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<TabFilter>('all');

  const filtered = useMemo(() => {
    if (filter === 'mine' && githubUser) {
      return pullRequests.filter((pr) => pr.author === githubUser);
    }
    if (filter === 'assigned' && githubUser) {
      return pullRequests.filter((pr) => pr.assignees.includes(githubUser));
    }
    return pullRequests;
  }, [pullRequests, filter, githubUser]);

  const columns: Column<PullRequest>[] = [
    {
      key: 'number',
      header: '#',
      shrink: true,
      render: (row) => <span className="text-zinc-500">#{row.number}</span>,
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <span className={cn('truncate', isStale(row.updatedAt) && 'text-amber-300/80')}>
          {row.title}
        </span>
      ),
    },
    {
      key: 'author',
      header: 'Author',
      shrink: true,
      render: (row) => <span className="text-zinc-400">{row.author}</span>,
    },
    {
      key: 'branch',
      header: 'Branch',
      shrink: true,
      render: (row) => (
        <span className="font-mono text-[11px] text-zinc-500">{row.headRefName}</span>
      ),
    },
    {
      key: 'diff',
      header: 'Diff',
      shrink: true,
      render: (row) => <DiffStatsBadge stats={diffStats[row.headRefName]} />,
    },
    {
      key: 'updated',
      header: 'Updated',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span
          className={cn('text-zinc-500', isStale(row.updatedAt) && 'text-amber-400/60')}
          title={new Date(row.updatedAt).toLocaleString()}
        >
          {formatRelativeTime(row.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <button
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-zinc-800/30"
        onClick={() => setCollapsed(!collapsed)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={cn('text-zinc-500 transition-transform', collapsed ? 'rotate-0' : 'rotate-90')}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>
        <span className="text-sm font-medium text-zinc-200">Open Pull Requests</span>
        <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
          {pullRequests.length}
        </span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-4">
          {/* Tab filters */}
          <div className="mb-2 flex gap-1">
            {(['all', 'mine', 'assigned'] as const).map((tab) => (
              <button
                key={tab}
                className={cn(
                  'rounded px-2 py-1 text-[11px] transition-colors',
                  filter === tab
                    ? 'bg-zinc-700 text-zinc-200'
                    : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300',
                )}
                onClick={() => setFilter(tab)}
              >
                {tab === 'all' ? 'All' : tab === 'mine' ? 'Opened by me' : 'Assigned to me'}
              </button>
            ))}
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            selectedIndex={null}
            onSelect={(i) => {
              const pr = filtered[i];
              if (pr) {
                window.open(`https://github.com/${org}/${name}/pull/${pr.number}`, '_blank');
              }
            }}
            loading={loading}
            emptyMessage="No open pull requests"
            maxHeight="max-h-64"
          />
        </div>
      )}
    </div>
  );
}
