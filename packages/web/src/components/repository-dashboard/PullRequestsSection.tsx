import { useState, useMemo, useCallback } from 'react';
import type { PullRequest, DiffStats, Ticket } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { useTicketStore } from '../../stores/ticketStore';
import { DataTable, type Column } from '../ui/DataTable';
import { DiffStatsBadge } from '../ui/DiffStatsBadge';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { ImportTaskButton } from '../dashboard/ImportTaskButton';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';
import { cn } from '../../lib/cn';
import { importGitHubPR, executeSkill } from '../../services/api';

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
  const [filter, setFilter] = useState<TabFilter>('all');
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const tickets = useTicketStore((s) => s.tickets);
  const boards = useTicketStore((s) => s.boards);
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);

  const ticketByPR = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of tickets) {
      for (const l of t.links) {
        if (l.type === 'github_pr') map.set(l.ref, t);
      }
    }
    return map;
  }, [tickets]);

  const filtered = useMemo(() => {
    if (filter === 'mine' && githubUser) {
      return pullRequests.filter((pr) => pr.author === githubUser);
    }
    if (filter === 'assigned' && githubUser) {
      return pullRequests.filter((pr) => pr.assignees.includes(githubUser));
    }
    return pullRequests;
  }, [pullRequests, filter, githubUser]);

  const handleImportPR = useCallback(async (pr: PullRequest, boardId: string) => {
    const key = `${org}/${name}#${pr.number}`;
    if (importingKey) return;
    setImportingKey(key);
    try {
      await importGitHubPR(org, name, pr.number, pr.title, pr.headRefName, boardId);
      await fetchDashboard(org, name);
    } catch {
      // handled by api layer
    } finally {
      setImportingKey(null);
    }
  }, [importingKey, org, name, fetchDashboard]);

  const columns: Column<PullRequest>[] = [
    {
      key: 'number',
      header: '#',
      shrink: true,
      render: (row) => <span className="text-[var(--theme-text-muted)]">#{row.number}</span>,
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
      render: (row) => <span className="text-[var(--theme-text-secondary)]">{row.author}</span>,
    },
    {
      key: 'branch',
      header: 'Branch',
      shrink: true,
      render: (row) => (
        <span className="font-mono text-xs text-[var(--theme-text-muted)]">{row.headRefName}</span>
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
          className={cn('text-[var(--theme-text-muted)]', isStale(row.updatedAt) && 'text-amber-400/60')}
          title={new Date(row.updatedAt).toLocaleString(undefined, { hour12: false })}
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
        const ref = `${org}/${name}#${row.number}`;
        const ticket = ticketByPR.get(ref);
        if (!ticket) {
          return (
            <span className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
              <ImportTaskButton
                boards={boards}
                onImport={(boardId) => handleImportPR(row, boardId)}
                importing={importingKey === ref}
              />
            </span>
          );
        }
        const prSessions = findSessionsForTicketId(ticket.id, sessionGroups);
        return (
          <span className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
            <SmartSessionButton
              sessions={prSessions}
              ticketId={ticket.id}
              onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id)}
              size="sm"
              alwaysShowMenu
            />
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
                ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-surface)] hover:text-[var(--theme-text-secondary)]',
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
