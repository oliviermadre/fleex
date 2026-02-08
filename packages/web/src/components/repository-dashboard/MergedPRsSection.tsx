import { useState } from 'react';
import type { PullRequest } from '@asm/shared';
import { DataTable, type Column } from '../ui/DataTable';
import { cn } from '../../lib/cn';

interface Props {
  org: string;
  name: string;
  mergedPRs: PullRequest[];
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

export function MergedPRsSection({ org, name, mergedPRs, loading }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const sorted = [...mergedPRs].sort((a, b) => {
    const aDate = a.mergedAt ?? a.updatedAt;
    const bDate = b.mergedAt ?? b.updatedAt;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

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
      render: (row) => <span className="truncate">{row.title}</span>,
    },
    {
      key: 'author',
      header: 'Author',
      shrink: true,
      render: (row) => <span className="text-zinc-400">{row.author}</span>,
    },
    {
      key: 'merged',
      header: 'Merged',
      shrink: true,
      align: 'right',
      render: (row) => {
        const date = row.mergedAt ?? row.updatedAt;
        return (
          <span className="text-emerald-400/70" title={new Date(date).toLocaleString()}>
            {formatRelativeTime(date)}
          </span>
        );
      },
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
        <span className="text-sm font-medium text-zinc-200">Recently Merged (7d)</span>
        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
          {mergedPRs.length}
        </span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-4">
          <DataTable
            columns={columns}
            data={sorted}
            selectedIndex={null}
            onSelect={(i) => {
              const pr = sorted[i];
              if (pr) {
                window.open(`https://github.com/${org}/${name}/pull/${pr.number}`, '_blank');
              }
            }}
            loading={loading}
            emptyMessage="No recently merged pull requests"
            maxHeight="max-h-48"
          />
        </div>
      )}
    </div>
  );
}
