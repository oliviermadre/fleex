import { useState, useMemo, useCallback } from 'react';
import type { GitHubIssue, GitHubLabel, Ticket } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { useTicketStore } from '../../stores/ticketStore';
import { Button } from '../ui/Button';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { ImportTaskButton } from '../dashboard/ImportTaskButton';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';
import { cn } from '../../lib/cn';
import { importGitHubIssue, executeSkill } from '../../services/api';

interface Props {
  org: string;
  name: string;
  openIssues: GitHubIssue[];
  closedIssues: GitHubIssue[];
  loading: boolean;
}

type IssueSegment = 'all' | 'open' | 'closed';

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

function LabelChip({ label }: { label: GitHubLabel }) {
  const color = `#${label.color}`;
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10.5px] leading-none"
      style={{ color, backgroundColor: `${color}1A`, borderColor: `${color}55` }}
    >
      {label.name}
    </span>
  );
}

const SEGMENTS: { key: IssueSegment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];

function filterIssues(open: GitHubIssue[], closed: GitHubIssue[], segment: IssueSegment): GitHubIssue[] {
  const base = segment === 'open' ? open : segment === 'closed' ? closed : [...open, ...closed];
  return [...base].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function IssuesSection({ org, name, openIssues, closedIssues, loading }: Props) {
  const [segment, setSegment] = useState<IssueSegment>('all');
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
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

  const filtered = useMemo(
    () => filterIssues(openIssues, closedIssues, segment),
    [openIssues, closedIssues, segment],
  );

  const segmentLabel = SEGMENTS.find((s) => s.key === segment)?.label ?? 'All';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] p-0.5">
          {SEGMENTS.map((s) => {
            const count = s.key === 'all' ? openIssues.length + closedIssues.length : s.key === 'open' ? openIssues.length : closedIssues.length;
            return (
              <button
                key={s.key}
                className={cn(
                  'rounded-md px-3 py-1 text-xs transition-colors',
                  segment === s.key
                    ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
                )}
                onClick={() => setSegment(s.key)}
              >
                {s.label} {count}
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-[11px] text-[var(--theme-text-faint)]">
        {segmentLabel} — {filtered.length} issues
      </div>

      <div className="flex flex-col gap-2">
        {loading && filtered.length === 0 ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-[68px] animate-pulse rounded-[11px] border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
            />
          ))
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--theme-text-muted)]">No issues match</div>
        ) : (
          filtered.map((row) => {
            const ref = `${org}/${name}#${row.number}`;
            const ticket = ticketByIssue.get(ref);
            const issueUrl = `https://github.com/${org}/${name}/issues/${row.number}`;
            const isOpen = row.state === 'open';

            return (
              <div
                key={`${row.state}-${row.number}`}
                className="flex items-center gap-4 rounded-[11px] border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-5 py-4 hover:bg-[var(--theme-bg-hover)]"
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="flex min-w-0 cursor-pointer items-center gap-2"
                    onClick={() => window.open(issueUrl, '_blank')}
                  >
                    <span className="font-mono text-xs text-[var(--theme-text-muted)]">#{row.number}</span>
                    <span
                      className={cn(
                        'truncate text-sm font-semibold',
                        isOpen ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)]',
                      )}
                    >
                      {row.title}
                    </span>
                    {row.labels.length > 0 && (
                      <span className="flex flex-shrink-0 items-center gap-1">
                        {row.labels.map((l) => (
                          <LabelChip key={l.name} label={l} />
                        ))}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-[var(--theme-text-muted)]">
                    {row.author} · {formatRelativeTime(row.createdAt)} ago
                    {row.commentsCount > 0 ? ` · ${row.commentsCount} comment${row.commentsCount === 1 ? '' : 's'}` : ''}
                  </span>
                </div>

                {ticket ? (
                  <SmartSessionButton
                    sessions={findSessionsForTicketId(ticket.id, sessionGroups)}
                    ticketId={ticket.id}
                    onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id)}
                    size="sm"
                    alwaysShowMenu
                  />
                ) : isOpen ? (
                  <ImportTaskButton
                    boards={boards}
                    onImport={(boardId) => handleImportIssue(row, boardId)}
                    importing={importingKey === ref}
                  />
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => window.open(issueUrl, '_blank')}>
                    Open
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
