import { useState, useCallback } from 'react';
import type { Worktree, DiffStats } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { DataTable, type Column } from '../ui/DataTable';
import { DiffStatsBadge } from '../ui/DiffStatsBadge';
import { cn } from '../../lib/cn';
import * as api from '../../services/api';

interface Props {
  org: string;
  name: string;
  worktrees: Worktree[];
  diffStats: Record<string, DiffStats>;
  loading: boolean;
}

export function WorktreesSection({ org, name, worktrees, diffStats, loading }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const selectSession = useSessionStore((s) => s.selectSession);

  const nonBareWorktrees = worktrees.filter((wt) => !wt.isBare);

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
      render: (row) => (
        <span className="truncate font-mono text-[11px] text-zinc-200">{row.branch}</span>
      ),
    },
    {
      key: 'path',
      header: 'Path',
      shrink: true,
      render: (row) => (
        <span className="text-[11px] text-zinc-500" title={row.path}>
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
        <span className="flex items-center justify-end gap-1">
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={(e) => {
              e.stopPropagation();
              handleCreateSession(row, 'shell');
            }}
            title="New Shell Session"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
              <polyline points="4.5,6.5 7,9 4.5,11.5" />
              <line x1="9" y1="11.5" x2="11.5" y2="11.5" />
            </svg>
          </button>
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-[#D77655]"
            onClick={(e) => {
              e.stopPropagation();
              handleCreateSession(row, 'claude');
            }}
            title="New Claude Session"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="4" cy="8" r="1.5" />
              <circle cx="8" cy="4" r="1.5" />
              <circle cx="12" cy="8" r="1.5" />
              <circle cx="8" cy="12" r="1.5" />
            </svg>
          </button>
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
        <span className="text-sm font-medium text-zinc-200">Local Worktrees</span>
        <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
          {nonBareWorktrees.length}
        </span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-4">
          <DataTable
            columns={columns}
            data={nonBareWorktrees}
            selectedIndex={null}
            onSelect={() => {}}
            loading={loading}
            emptyMessage="No local worktrees. Create one from a PR or branch."
            maxHeight="max-h-48"
          />
        </div>
      )}
    </div>
  );
}
