import { useState, useMemo, useCallback } from 'react';
import type { PullRequest, DiffStats, Ticket, Worktree } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketActivityStore } from '../../stores/ticketActivityStore';
import { DiffStatsBadge } from '../ui/DiffStatsBadge';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Button } from '../ui/Button';
import { PrBadge } from '../ui/PrBadge';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { ImportTaskButton } from '../dashboard/ImportTaskButton';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';
import { cn } from '../../lib/cn';
import { tintText, tintClasses } from '../../lib/tints';
import * as api from '../../services/api';
import { filterPulls, type PrSegment } from './prFilters';

interface Props {
  org: string;
  name: string;
  openPRs: PullRequest[];
  mergedPRs: PullRequest[];
  worktrees: Worktree[];
  diffStats: Record<string, DiffStats>;
  githubUser: string | null;
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

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,8 6.5,12 13,4" />
    </svg>
  );
}

const SEGMENTS: { key: PrSegment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'merged', label: 'Merged' },
];

export function PullRequestsSection({ org, name, openPRs, mergedPRs, worktrees, diffStats, githubUser, loading }: Props) {
  const [segment, setSegment] = useState<PrSegment>('all');
  const [mine, setMine] = useState(false);
  const [assigned, setAssigned] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [cleanupTarget, setCleanupTarget] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const tickets = useTicketStore((s) => s.tickets);
  const boards = useTicketStore((s) => s.boards);
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);
  const costByTicket = useTicketActivityStore((s) => s.costByTicket);

  const ticketByPR = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of tickets) {
      for (const l of t.links) {
        if (l.type === 'github_pr') map.set(l.ref, t);
      }
    }
    return map;
  }, [tickets]);

  const filtered = useMemo(
    () => filterPulls(openPRs, mergedPRs, segment, mine, assigned, githubUser),
    [openPRs, mergedPRs, segment, mine, assigned, githubUser],
  );

  const handleImportPR = useCallback(async (pr: PullRequest, boardId: string) => {
    const key = `${org}/${name}#${pr.number}`;
    if (importingKey) return;
    setImportingKey(key);
    try {
      await api.importGitHubPR(org, name, pr.number, pr.title, pr.headRefName, boardId);
      await fetchDashboard(org, name);
    } catch {
      // handled by api layer
    } finally {
      setImportingKey(null);
    }
  }, [importingKey, org, name, fetchDashboard]);

  const cleanupWorktree = useMemo(
    () => worktrees.find((wt) => wt.branch === cleanupTarget) ?? null,
    [worktrees, cleanupTarget],
  );

  const handleCleanupConfirm = useCallback(async () => {
    if (!cleanupWorktree) {
      setCleanupTarget(null);
      return;
    }
    setCleaning(true);
    try {
      await api.deleteWorktree(org, name, cleanupWorktree.path);
      await fetchDashboard(org, name);
    } finally {
      setCleaning(false);
      setCleanupTarget(null);
    }
  }, [cleanupWorktree, org, name, fetchDashboard]);

  const segmentLabel = SEGMENTS.find((s) => s.key === segment)?.label ?? 'All';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] p-0.5">
          {SEGMENTS.map((s) => {
            const count = s.key === 'all' ? openPRs.length + mergedPRs.length : s.key === 'open' ? openPRs.length : mergedPRs.length;
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
        <div className="h-4 w-px bg-[var(--theme-border)]" />
        <button
          className={cn(
            'flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors',
            mine
              ? cn('border', tintClasses('purple').borderColor, tintClasses('purple').bg, tintClasses('purple').text)
              : 'border border-[var(--theme-border)] text-[var(--theme-text-muted)]',
          )}
          onClick={() => setMine((v) => !v)}
        >
          {mine && <CheckIcon />}
          Created by me
        </button>
        <button
          className={cn(
            'flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors',
            assigned
              ? cn('border', tintClasses('purple').borderColor, tintClasses('purple').bg, tintClasses('purple').text)
              : 'border border-[var(--theme-border)] text-[var(--theme-text-muted)]',
          )}
          onClick={() => setAssigned((v) => !v)}
        >
          {assigned && <CheckIcon />}
          Assigned to me
        </button>
      </div>

      <div className="text-[11px] text-[var(--theme-text-faint)]">
        {segmentLabel}
        {mine ? ' · created by me' : ''}
        {assigned ? ' · assigned to me' : ''} — {filtered.length} pull requests
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
          <div className="py-8 text-center text-sm text-[var(--theme-text-muted)]">No pull requests match</div>
        ) : (
          filtered.map((row) => {
            const ref = `${org}/${name}#${row.number}`;
            const ticket = ticketByPR.get(ref);
            const prUrl = `https://github.com/${org}/${name}/pull/${row.number}`;
            const isOpen = row.state === 'open';
            const lingering = !isOpen && worktrees.some((wt) => wt.branch === row.headRefName);
            const cost = ticket ? costByTicket[ticket.id] : undefined;

            return (
              <div
                key={`${row.state}-${row.number}`}
                className={cn(
                  'flex items-center gap-4 rounded-[11px] border bg-[var(--theme-bg-surface)] px-5 py-4 hover:bg-[var(--theme-bg-hover)]',
                  lingering ? tintClasses('red').borderColor : 'border-[var(--theme-border)]',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="flex min-w-0 cursor-pointer items-center gap-2"
                    onClick={() => window.open(prUrl, '_blank')}
                  >
                    <PrBadge org={org} name={name} pr={row} />
                    <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{row.title}</span>
                  </div>
                  {isOpen ? (
                    <span className="font-mono text-[11px] text-[var(--theme-text-muted)]">
                      {row.headRefName} · {row.author} · {formatRelativeTime(row.updatedAt)}
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-[var(--theme-text-muted)]">
                      merged {formatRelativeTime(row.mergedAt ?? row.updatedAt)} ago ·{' '}
                      {lingering ? <span className={tintText('red')}>worktree still present</span> : 'worktree cleaned'}
                    </span>
                  )}
                </div>

                {isOpen && <DiffStatsBadge stats={diffStats[row.headRefName]} />}

                {!isOpen && ticket && cost !== undefined && (
                  <span className={cn('rounded-md px-1.5 py-0.5 font-mono text-[10.5px]', tintClasses('pink').bg, tintClasses('pink').text)}>
                    ${cost.toFixed(2)}
                  </span>
                )}

                {isOpen ? (
                  ticket ? (
                    <SmartSessionButton
                      sessions={findSessionsForTicketId(ticket.id, sessionGroups)}
                      ticketId={ticket.id}
                      onExecuteSkill={(skillId) => api.executeSkill(skillId, ticket.id)}
                      size="sm"
                      alwaysShowMenu
                    />
                  ) : (
                    <ImportTaskButton
                      boards={boards}
                      onImport={(boardId) => handleImportPR(row, boardId)}
                      importing={importingKey === ref}
                    />
                  )
                ) : lingering ? (
                  <Button variant="danger" size="sm" onClick={() => setCleanupTarget(row.headRefName)}>
                    Delete worktree
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => window.open(prUrl, '_blank')}>
                    View PR
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      <ConfirmModal
        open={cleanupTarget !== null}
        busy={cleaning}
        title="Delete worktree"
        message={
          cleanupWorktree && (
            <span>
              Delete the worktree for branch <span className="font-mono">{cleanupWorktree.branch}</span> at{' '}
              <span className="font-mono">{cleanupWorktree.path}</span>?
            </span>
          )
        }
        confirmLabel="Delete"
        onCancel={() => setCleanupTarget(null)}
        onConfirm={handleCleanupConfirm}
      />
    </div>
  );
}
