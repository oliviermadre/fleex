import { useState, useMemo, useCallback } from 'react';
import type { GitHubIssue, Ticket } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { useTicketStore } from '../../stores/ticketStore';
import { DataTable, type Column } from '../ui/DataTable';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { ImportTaskButton } from '../dashboard/ImportTaskButton';
import { importGitHubIssue } from '../../services/api';

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

export function IssuesBanner({ org, name, issues, loading }: Props) {
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const sessions = useSessionStore((s) => s.sessions);
  const tickets = useTicketStore((s) => s.tickets);
  const boards = useTicketStore((s) => s.boards);
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);

  const ticketByIssue = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of tickets) {
      for (const l of t.links) {
        if (l.type === 'github_issue') map.set(l.ref, t);
      }
    }
    return map;
  }, [tickets]);

  const handleImportIssue = useCallback(async (issue: GitHubIssue, boardId: string) => {
    const key = `${org}/${name}#${issue.number}`;
    if (importingKey) return;
    setImportingKey(key);
    try {
      await importGitHubIssue(org, name, issue.number, boardId);
      await fetchDashboard(org, name);
    } catch {
      // handled by api layer
    } finally {
      setImportingKey(null);
    }
  }, [importingKey, org, name, fetchDashboard]);

  const columns: Column<GitHubIssue>[] = [
    {
      key: 'number',
      header: '#',
      shrink: true,
      render: (row) => <span className="text-[var(--theme-text-muted)]">#{row.number}</span>,
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => <span className="truncate text-[var(--theme-text-secondary)]">{row.title}</span>,
    },
    {
      key: 'author',
      header: 'Author',
      shrink: true,
      render: (row) => <span className="text-[var(--theme-text-secondary)]">{row.author}</span>,
    },
    {
      key: 'created',
      header: 'Created',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span className="text-[var(--theme-text-muted)]" title={new Date(row.createdAt).toLocaleString(undefined, { hour12: false })}>
          {formatRelativeTime(row.createdAt)}
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
        const ticket = ticketByIssue.get(ref);
        if (!ticket) {
          return (
            <span className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
              <ImportTaskButton
                boards={boards}
                onImport={(boardId) => handleImportIssue(row, boardId)}
                importing={importingKey === ref}
              />
            </span>
          );
        }
        const issueSessions = sessions.filter(
          (s) => s.status === 'running'
            && s.repositoryOrg === org && s.repositoryName === name
            && s.worktreeBranch?.startsWith(`issue-${row.number}-`),
        );
        return (
          <span className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
            <SmartSessionButton
              sessions={issueSessions}
              ticketId={ticket.id}
              size="sm"
            />
          </span>
        );
      },
    },
  ];

  return (
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
      emptyMessage="No issues assigned to you"
      maxHeight="max-h-[calc(100vh-14rem)]"
    />
  );
}
