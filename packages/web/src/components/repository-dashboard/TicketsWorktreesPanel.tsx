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
import { getPrBadgeClasses } from '../../lib/prBadgeStyle';
import * as api from '../../services/api';
import type { WorktreeRow } from './overview-helpers';

interface Props {
  org: string;
  name: string;
  rows: { active: WorktreeRow[]; orphaned: WorktreeRow[] };
  onDeleted: () => void;
  /** When set, cap each group to this many rows and show a "N →" link instead of the filter toggle (Overview preview mode). */
  limit?: number;
  /** Called when the "N →" link is clicked (navigate to the full Worktrees tab). */
  onSeeAll?: () => void;
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

function PrBadge({ org, name, pr }: { org: string; name: string; pr: PullRequest }) {
  return (
    <a
      href={`https://github.com/${org}/${name}/pull/${pr.number}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={pr.title}
      className={cn('inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition-colors', getPrBadgeClasses(pr))}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      </svg>
      {name}#{pr.number}
    </a>
  );
}

export function TicketsWorktreesPanel({ org, name, rows, onDeleted, limit, onSeeAll }: Props) {
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

  const limited = limit !== undefined;
  const effectiveFilter: WorktreeFilter = limited ? 'all' : filter;
  const total = rows.active.length + rows.orphaned.length;
  const activeGroup = effectiveFilter === 'stale' ? [] : rows.active;
  const staleGroup = effectiveFilter === 'active' ? [] : rows.orphaned;
  const visibleActive = limited ? activeGroup.slice(0, limit) : activeGroup;
  const visibleStale = limited ? staleGroup.slice(0, limit) : staleGroup;
  const nothingVisible = visibleActive.length === 0 && visibleStale.length === 0;
  const showBands = effectiveFilter === 'all';

  const SEGMENTS: { key: WorktreeFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: total },
    { key: 'active', label: 'Active', count: rows.active.length },
    { key: 'stale', label: 'Stale', count: rows.orphaned.length },
  ];

  return (
    <div id="tickets-worktrees-panel" className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--theme-border)] px-5 py-3">
        <span className="text-sm font-semibold">Worktrees</span>
        {total > 0 && (limited ? (
          <button type="button" onClick={onSeeAll} className="text-xs text-[var(--theme-accent)] hover:underline">
            {total} →
          </button>
        ) : (
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
        ))}
      </div>

      {nothingVisible ? (
        <div className="py-10 text-center text-sm text-[var(--theme-text-muted)]">
          {effectiveFilter === 'stale' ? 'No stale worktrees' : 'No active worktrees'}
        </div>
      ) : (
        <>
          {showBands && visibleActive.length > 0 && (
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
                    {row.pr && <PrBadge org={org} name={name} pr={row.pr} />}
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
              {showBands && (
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
                        {row.pr && <PrBadge org={org} name={name} pr={row.pr} />}
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
