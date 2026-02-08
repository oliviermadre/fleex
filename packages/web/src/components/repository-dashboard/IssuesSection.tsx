import { useState } from 'react';
import type { GitHubIssue } from '@asm/shared';
import { DataTable, type Column } from '../ui/DataTable';
import { cn } from '../../lib/cn';

interface Props {
  org: string;
  name: string;
  issues: GitHubIssue[];
  loading: boolean;
}

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

const columns: Column<GitHubIssue>[] = [
  {
    key: 'number',
    header: '#',
    shrink: true,
    render: (row) => <span className="text-zinc-500">#{row.number}</span>,
  },
  {
    key: 'title',
    header: 'Title',
    render: (row) => <span className="truncate">{row.title}</span>,
  },
  {
    key: 'author',
    header: 'Author',
    shrink: true,
    render: (row) => <span className="text-zinc-400">{row.author}</span>,
  },
  {
    key: 'created',
    header: 'Created',
    shrink: true,
    align: 'right',
    render: (row) => (
      <span className="text-zinc-500" title={new Date(row.createdAt).toLocaleString()}>
        {formatRelativeTime(row.createdAt)}
      </span>
    ),
  },
];

export function IssuesSection({ org, name, issues, loading }: Props) {
  const [collapsed, setCollapsed] = useState(false);

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
        <span className="text-sm font-medium text-zinc-200">Open Issues</span>
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
          {issues.length}
        </span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-4">
          <DataTable
            columns={columns}
            data={issues}
            selectedIndex={null}
            onSelect={(i) => {
              const issue = issues[i];
              if (issue) {
                window.open(`https://github.com/${org}/${name}/issues/${issue.number}`, '_blank');
              }
            }}
            loading={loading}
            emptyMessage="No open issues assigned to you"
            maxHeight="max-h-48"
          />
        </div>
      )}
    </div>
  );
}
