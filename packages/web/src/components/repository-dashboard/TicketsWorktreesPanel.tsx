import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PullRequest, TicketType } from '@fleex/shared';
import { useTicketActivityStore } from '../../stores/ticketActivityStore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { TrashIcon } from '../ui/TrashIcon';
import { PriorityIndicator } from '../tickets/PriorityIndicator';
import { VERDICT_META } from '../../lib/worktreeVerdict';
import { cn } from '../../lib/cn';
import { tint, tintText, tintClasses, type TintHue } from '../../lib/tints';
import { getStatusBadgeClass } from '../../lib/statusColors';
import * as api from '../../services/api';
import type { WorktreeRow } from './overview-helpers';

interface Props {
  org: string;
  name: string;
  rows: { active: WorktreeRow[]; orphaned: WorktreeRow[] };
  onDeleted: () => void;
}

type WorktreeFilter = 'all' | 'active' | 'stale';

const TYPE_HUE: Record<TicketType, TintHue> = {
  fix: 'red',
  build: 'green',
  ops: 'teal',
  think: 'indigo',
  review: 'purple',
  lead: 'orange',
};

const PR_STATE_HUE: Record<PullRequest['state'], TintHue> = {
  open: 'green',
  merged: 'purple',
  closed: 'red',
};

function BranchIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="12" cy="8" r="1.5" />
      <line x1="4" y1="5.5" x2="4" y2="10.5" />
      <path d="M4 5.5a4 4 0 004 4h2.5" />
    </svg>
  );
}

function PrBadge({ repoName, pr }: { repoName: string; pr: PullRequest }) {
  return (
    <span className={cn('flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px]', tint(PR_STATE_HUE[pr.state]))}>
      <BranchIcon />
      {repoName}#{pr.number}
      {pr.state !== 'open' && <span className="opacity-80">· {pr.state}</span>}
    </span>
  );
}

export function TicketsWorktreesPanel({ org, name, rows, onDeleted }: Props) {
  const navigate = useNavigate();
  const costByTicket = useTicketActivityStore((s) => s.costByTicket);
  const [pendingDelete, setPendingDelete] = useState<WorktreeRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<WorktreeFilter>('all');

  const handleConfirm = useCallback(async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.deleteWorktree(org, name, pendingDelete.worktree.path);
      onDeleted();
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }, [pendingDelete, org, name, onDeleted]);

  const total = rows.active.length + rows.orphaned.length;
  const visibleActive = filter === 'stale' ? [] : rows.active;
  const visibleStale = filter === 'active' ? [] : rows.orphaned;
  const nothingVisible = visibleActive.length === 0 && visibleStale.length === 0;

  const SEGMENTS: { key: WorktreeFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: total },
    { key: 'active', label: 'Active', count: rows.active.length },
    { key: 'stale', label: 'Stale', count: rows.orphaned.length },
  ];

  return (
    <div id="tickets-worktrees-panel" className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--theme-border)] px-5 py-3">
        <span className="text-sm font-semibold">Tickets & worktrees</span>
        {total > 0 && (
          <div className="flex rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] p-0.5">
            {SEGMENTS.map((s) => (
              <button
                key={s.key}
                className={cn(
                  'rounded-md px-3 py-1 text-xs transition-colors',
                  filter === s.key
                    ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
                )}
                onClick={() => setFilter(s.key)}
              >
                {s.label} {s.count}
              </button>
            ))}
          </div>
        )}
      </div>

      {nothingVisible ? (
        <div className="py-10 text-center text-sm text-[var(--theme-text-muted)]">
          {filter === 'stale' ? 'No stale worktrees' : 'No active worktrees'}
        </div>
      ) : (
        <>
          {filter === 'all' && visibleActive.length > 0 && (
            <div className="flex items-center gap-2 border-b border-[var(--theme-border-subtle)] bg-[var(--theme-bg-overlay)] px-5 py-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Active</span>
              <span className="text-[10.5px] text-[var(--theme-text-faint)]">{rows.active.length}</span>
            </div>
          )}
          {visibleActive.map((row) => {
            const ticket = row.ticket;
            if (!ticket) return null;
            const cost = costByTicket[ticket.id];
            const ahead = row.diff?.commitsAhead ?? 0;
            const behind = row.diff?.commitsBehind ?? 0;

            return (
              <div key={row.worktree.path} className="group flex items-center gap-2 border-b border-[var(--theme-border-subtle)] px-5 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-xs text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
                    <PriorityIndicator priority={ticket.priority} size="sm" />
                    {ticket.type && (
                      <span className={cn('flex-shrink-0 text-[12px] font-medium capitalize', tintText(TYPE_HUE[ticket.type]))}>
                        {ticket.type}
                      </span>
                    )}
                    <span
                      className="min-w-0 flex-1 cursor-pointer truncate text-[13.5px] font-semibold text-[var(--theme-text-primary)] hover:underline"
                      onClick={() => navigate(`/tickets/board/${ticket.boardId}/ticket/${ticket.id}`)}
                    >
                      {ticket.title}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-[12px] text-[var(--theme-text-secondary)]">└ {row.worktree.branch}</span>
                    {ahead > 0 && <span className={cn('font-mono text-[11px]', tintText('green'))}>↑{ahead}</span>}
                    {behind > 0 && <span className={cn('font-mono text-[11px]', tintText('red'))}>↓{behind}</span>}
                    {row.pr && <PrBadge repoName={name} pr={row.pr} />}
                    <span className={cn('rounded-md px-1.5 py-0.5 text-[10.5px]', tint(VERDICT_META[row.verdict].hue))}>
                      {VERDICT_META[row.verdict].label}
                    </span>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10.5px]', getStatusBadgeClass(ticket.status))}>
                    {ticket.status}
                  </span>
                  {cost !== undefined && (
                    <span className={cn('rounded-md px-1.5 py-0.5 font-mono text-[10.5px]', tintClasses('pink').bg, tintClasses('pink').text)}>
                      ${cost.toFixed(2)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className={cn(
                    'hidden flex-shrink-0 items-center justify-center rounded p-0.5 text-[var(--theme-text-faint)] transition-colors group-hover:flex',
                    tintClasses('red').hoverText,
                  )}
                  title="Delete worktree"
                  onClick={() => setPendingDelete(row)}
                >
                  <TrashIcon />
                </button>
              </div>
            );
          })}

          {visibleStale.length > 0 && (
            <div id="orphaned-worktrees">
              {filter === 'all' && (
                <div className="flex items-center gap-2 border-b border-[var(--theme-border-subtle)] bg-[var(--theme-bg-overlay)] px-5 py-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Stale</span>
                  <span className="text-[10.5px] text-[var(--theme-text-faint)]">{rows.orphaned.length}</span>
                </div>
              )}
              {visibleStale.map((row) => {
                const ticket = row.ticket;
                const behind = row.diff?.commitsBehind ?? 0;
                return (
                  <div key={row.worktree.path} className="flex items-center gap-2 border-b border-[var(--theme-border-subtle)] px-5 py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      {ticket && (
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="font-mono text-xs text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
                          <PriorityIndicator priority={ticket.priority} size="sm" />
                          {ticket.type && (
                            <span className={cn('flex-shrink-0 text-[12px] font-medium capitalize', tintText(TYPE_HUE[ticket.type]))}>
                              {ticket.type}
                            </span>
                          )}
                          <span
                            className="min-w-0 flex-1 cursor-pointer truncate text-[13.5px] font-semibold text-[var(--theme-text-secondary)] hover:underline"
                            onClick={() => navigate(`/tickets/board/${ticket.boardId}/ticket/${ticket.id}`)}
                          >
                            {ticket.title}
                          </span>
                        </div>
                      )}
                      <div className={cn('flex items-center gap-2', ticket && 'mt-1')}>
                        <span className="font-mono text-[12px] text-[var(--theme-text-secondary)]">
                          {ticket ? '└ ' : ''}{row.worktree.branch}
                        </span>
                        {behind > 0 && <span className={cn('font-mono text-[11px]', tintText('red'))}>↓{behind}</span>}
                        {row.pr && <PrBadge repoName={name} pr={row.pr} />}
                      </div>
                    </div>
                    {ticket && (
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <span className={cn('rounded-md px-1.5 py-0.5 text-[10.5px]', getStatusBadgeClass(ticket.status))}>
                          {ticket.status}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={cn(
                        'flex flex-shrink-0 items-center justify-center rounded p-0.5 text-[var(--theme-text-faint)] transition-colors',
                        tintClasses('red').hoverText,
                      )}
                      title="Delete worktree"
                      onClick={() => setPendingDelete(row)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        busy={busy}
        title="Delete worktree"
        message={
          pendingDelete && (
            <span>
              Delete the worktree for branch <span className="font-mono">{pendingDelete.worktree.branch}</span> at{' '}
              <span className="font-mono">{pendingDelete.worktree.path}</span>?
            </span>
          )
        }
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
