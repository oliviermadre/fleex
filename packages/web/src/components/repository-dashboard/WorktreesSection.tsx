import { useCallback } from 'react';
import type { Worktree, DiffStats, PullRequest } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { DataTable, type Column } from '../ui/DataTable';
import { DiffStatsBadge } from '../ui/DiffStatsBadge';
import * as api from '../../services/api';

interface Props {
  org: string;
  name: string;
  worktrees: Worktree[];
  diffStats: Record<string, DiffStats>;
  openPullRequests: PullRequest[];
  mergedPullRequests: PullRequest[];
  loading: boolean;
}

export function WorktreesSection({ org, name, worktrees, diffStats, openPullRequests, mergedPullRequests, loading }: Props) {
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const selectSession = useSessionStore((s) => s.selectSession);
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);

  const nonBareWorktrees = worktrees.filter((wt) => !wt.isBare);

  const branchToPR = new Map<string, number>();
  for (const pr of openPullRequests) {
    branchToPR.set(pr.headRefName, pr.number);
  }

  const branchToMergedPR = new Map<string, number>();
  for (const pr of mergedPullRequests) {
    branchToMergedPR.set(pr.headRefName, pr.number);
  }

  const handleCreateSession = useCallback(async (wt: Worktree, type: 'shell' | 'claude') => {
    try {
      const session = await api.createSession({
        type,
        cwd: wt.path,
      });
      selectSession(session.id);
      setActivePanel('sessions');
    } catch {
      // ignore
    }
  }, [selectSession, setActivePanel]);

  const handleDelete = useCallback(async (wt: Worktree) => {
    const shortPath = shortenPath(wt.path);
    if (!window.confirm(`Delete worktree at ${shortPath}?`)) return;
    try {
      await api.deleteWorktree(org, name, wt.path);
      fetchDashboard(org, name);
    } catch {
      // ignore
    }
  }, [org, name, fetchDashboard]);

  function shortenPath(path: string): string {
    const home = path.replace(/^\/Users\/[^/]+/, '~');
    const parts = home.split('/');
    if (parts.length > 3) {
      return `.../${parts.slice(-2).join('/')}`;
    }
    return home;
  }

  const columns: Column<Worktree>[] = [
    {
      key: 'branch',
      header: 'Branch',
      render: (row) => {
        const prNumber = branchToPR.get(row.branch);
        const mergedPRNumber = branchToMergedPR.get(row.branch);
        return (
          <span className="flex items-center gap-2 truncate">
            <span className="truncate font-mono text-xs text-[var(--theme-text-primary)]">{row.branch}</span>
            {prNumber != null && (
              <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[11px] font-medium text-blue-400">
                PR #{prNumber}
              </span>
            )}
            {mergedPRNumber != null && (
              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-400">
                Merged
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'path',
      header: 'Path',
      shrink: true,
      render: (row) => (
        <span className="text-xs text-[var(--theme-text-muted)]" title={row.path}>
          {shortenPath(row.path)}
        </span>
      ),
    },
    {
      key: 'diff',
      header: 'Diff',
      shrink: true,
      render: (row) => <DiffStatsBadge stats={diffStats[row.branch]} />,
    },
    {
      key: 'actions',
      header: '',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-1.5">
          <button
            className="rounded p-1.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-secondary)]"
            onClick={(e) => {
              e.stopPropagation();
              handleCreateSession(row, 'shell');
            }}
            title="New Shell Session"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
              <polyline points="4.5,6.5 7,9 4.5,11.5" />
              <line x1="9" y1="11.5" x2="11.5" y2="11.5" />
            </svg>
          </button>
          <button
            className="rounded p-1.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-accent)]"
            onClick={(e) => {
              e.stopPropagation();
              handleCreateSession(row, 'claude');
            }}
            title="New Claude Session"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="4" cy="8" r="1.5" />
              <circle cx="8" cy="4" r="1.5" />
              <circle cx="12" cy="8" r="1.5" />
              <circle cx="8" cy="12" r="1.5" />
            </svg>
          </button>
          <button
            className="rounded p-1.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(row);
            }}
            title="Delete Worktree"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12" />
              <path d="M5.5 4V2.5h5V4" />
              <path d="M3.5 4l.75 9.5h7.5L12.5 4" />
              <path d="M6.5 7v4" />
              <path d="M9.5 7v4" />
            </svg>
          </button>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={nonBareWorktrees}
      selectedIndex={null}
      onSelect={() => {}}
      loading={loading}
      emptyMessage="No local worktrees. Create one from a PR or branch."
      maxHeight="max-h-[calc(100vh-14rem)]"
    />
  );
}
