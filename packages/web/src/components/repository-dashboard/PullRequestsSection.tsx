import { useState, useMemo, useCallback } from 'react';
import type { PullRequest, DiffStats, Worktree } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { DataTable, type Column } from '../ui/DataTable';
import { DiffStatsBadge } from '../ui/DiffStatsBadge';
import { cn } from '../../lib/cn';
import * as api from '../../services/api';

interface Props {
  org: string;
  name: string;
  pullRequests: PullRequest[];
  diffStats: Record<string, DiffStats>;
  githubUser: string | null;
  worktrees: Worktree[];
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

export function PullRequestsSection({ org, name, pullRequests, diffStats, githubUser, worktrees, loading }: Props) {
  const [filter, setFilter] = useState<TabFilter>('all');
  const [creating, setCreating] = useState<Set<number>>(new Set());
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const selectSession = useSessionStore((s) => s.selectSession);
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);

  const filtered = useMemo(() => {
    if (filter === 'mine' && githubUser) {
      return pullRequests.filter((pr) => pr.author === githubUser);
    }
    if (filter === 'assigned' && githubUser) {
      return pullRequests.filter((pr) => pr.assignees.includes(githubUser));
    }
    return pullRequests;
  }, [pullRequests, filter, githubUser]);

  const handleCreateSession = useCallback(async (pr: PullRequest, type: 'shell' | 'claude') => {
    if (creating.has(pr.number)) return;
    setCreating((prev) => new Set(prev).add(pr.number));
    try {
      const existingWt = worktrees.find((wt) => wt.branch === pr.headRefName);
      let cwd: string;
      if (existingWt) {
        cwd = existingWt.path;
      } else {
        const { path } = await api.createWorktree(org, name, {
          branch: pr.headRefName,
          createNewBranch: false,
          prNumber: pr.number,
        });
        cwd = path;
      }
      const session = await api.createSession({ type, cwd });
      selectSession(session.id);
      setActivePanel('sessions');
      fetchDashboard(org, name);
    } catch {
      // ignore
    } finally {
      setCreating((prev) => {
        const next = new Set(prev);
        next.delete(pr.number);
        return next;
      });
    }
  }, [creating, worktrees, org, name, selectSession, setActivePanel, fetchDashboard]);

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
        <span className="font-mono text-xs text-zinc-500">{row.headRefName}</span>
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
    {
      key: 'actions',
      header: '',
      shrink: true,
      align: 'right',
      render: (row) => {
        const busy = creating.has(row.number);
        return (
          <span className="flex items-center justify-end gap-1.5">
            <button
              className={cn(
                'rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300',
                busy && 'pointer-events-none opacity-40',
              )}
              onClick={(e) => {
                e.stopPropagation();
                handleCreateSession(row, 'shell');
              }}
              title="New Shell Session"
              disabled={busy}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
                <polyline points="4.5,6.5 7,9 4.5,11.5" />
                <line x1="9" y1="11.5" x2="11.5" y2="11.5" />
              </svg>
            </button>
            <button
              className={cn(
                'rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-[#D77655]',
                busy && 'pointer-events-none opacity-40',
              )}
              onClick={(e) => {
                e.stopPropagation();
                handleCreateSession(row, 'claude');
              }}
              title="New Claude Session"
              disabled={busy}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="4" cy="8" r="1.5" />
                <circle cx="8" cy="4" r="1.5" />
                <circle cx="12" cy="8" r="1.5" />
                <circle cx="8" cy="12" r="1.5" />
              </svg>
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        {(['all', 'mine', 'assigned'] as const).map((tab) => (
          <button
            key={tab}
            className={cn(
              'rounded px-2.5 py-1 text-xs transition-colors',
              filter === tab
                ? 'bg-zinc-700 text-zinc-200'
                : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300',
            )}
            onClick={() => setFilter(tab)}
          >
            {tab === 'all' ? 'All' : tab === 'mine' ? 'Mine' : 'Assigned'}
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
        maxHeight="max-h-[calc(100vh-14rem)]"
      />
    </div>
  );
}
