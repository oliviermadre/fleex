import type { PullRequest } from '@asm/shared';
import { DataTable, type Column } from '../ui/DataTable';

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
      key: 'branch',
      header: 'Branch',
      shrink: true,
      render: (row) => (
        <span className="font-mono text-xs text-zinc-500">{row.headRefName}</span>
      ),
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
      maxHeight="max-h-[calc(100vh-14rem)]"
    />
  );
}
