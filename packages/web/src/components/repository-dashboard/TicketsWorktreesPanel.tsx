import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TicketStatus, TicketType } from '@fleex/shared';
import { useTicketActivityStore } from '../../stores/ticketActivityStore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Button } from '../ui/Button';
import { TrashIcon } from '../ui/TrashIcon';
import { VERDICT_META } from '../../lib/worktreeVerdict';
import { cn } from '../../lib/cn';
import { tint, tintText, tintClasses, type TintHue } from '../../lib/tints';
import * as api from '../../services/api';
import type { WorktreeRow } from './overview-helpers';

interface Props {
  org: string;
  name: string;
  rows: { active: WorktreeRow[]; orphaned: WorktreeRow[] };
  onDeleted: () => void;
}

const TYPE_HUE: Record<TicketType, TintHue> = {
  fix: 'red',
  build: 'green',
  ops: 'teal',
  think: 'indigo',
  review: 'purple',
  lead: 'orange',
};

const STATUS_HUE: Record<TicketStatus, TintHue> = {
  backlog: 'gray',
  todo: 'gray',
  doing: 'yellow',
  reviewing: 'purple',
  done: 'green',
  cancelled: 'red',
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

export function TicketsWorktreesPanel({ org, name, rows, onDeleted }: Props) {
  const navigate = useNavigate();
  const costByTicket = useTicketActivityStore((s) => s.costByTicket);
  const [pendingDelete, setPendingDelete] = useState<WorktreeRow | null>(null);
  const [busy, setBusy] = useState(false);

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

  const isEmpty = rows.active.length === 0 && rows.orphaned.length === 0;

  return (
    <div id="tickets-worktrees-panel" className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      <div className="px-5 py-3 text-sm font-semibold border-b border-[var(--theme-border)]">Tickets & worktrees</div>

      {isEmpty ? (
        <div className="py-10 text-center text-sm text-[var(--theme-text-muted)]">No active worktrees</div>
      ) : (
        <>
          {rows.active.map((row) => {
            const ticket = row.ticket;
            if (!ticket) return null;
            const cost = costByTicket[ticket.id];
            const ahead = row.diff?.commitsAhead ?? 0;
            const behind = row.diff?.commitsBehind ?? 0;

            return (
              <div key={row.worktree.path} className="group border-b border-[var(--theme-border-subtle)] px-5 py-3 last:border-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
                  {ticket.type && (
                    <span className={cn('flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px]', tint(TYPE_HUE[ticket.type]))}>
                      {ticket.type}
                    </span>
                  )}
                  <span
                    className="min-w-0 flex-1 cursor-pointer truncate text-[13.5px] font-semibold text-[var(--theme-text-primary)] hover:underline"
                    onClick={() => navigate(`/tickets/board/${ticket.boardId}/ticket/${ticket.id}`)}
                  >
                    {ticket.title}
                  </span>
                  <span className={cn('flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px]', tint(STATUS_HUE[ticket.status]))}>
                    {ticket.status}
                  </span>
                  {cost !== undefined && (
                    <span className={cn('flex-shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10.5px]', tintClasses('pink').bg, tintClasses('pink').text)}>
                      ${cost.toFixed(2)}
                    </span>
                  )}
                  {row.pr && (
                    <span className={cn('flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px]', tint('green'))}>
                      <BranchIcon />
                      {name}#{row.pr.number}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-[12px] text-[var(--theme-text-secondary)]">└ {row.worktree.branch}</span>
                  {ahead > 0 && <span className={cn('font-mono text-[11px]', tintText('green'))}>↑{ahead}</span>}
                  {behind > 0 && <span className={cn('font-mono text-[11px]', tintText('red'))}>↓{behind}</span>}
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10.5px]', tint(VERDICT_META[row.verdict].hue))}>
                    {VERDICT_META[row.verdict].label}
                  </span>
                  <button
                    type="button"
                    className={cn(
                      'ml-auto hidden flex-shrink-0 items-center justify-center rounded p-0.5 text-[var(--theme-text-faint)] transition-colors group-hover:flex',
                      tintClasses('red').hoverText,
                    )}
                    title="Delete worktree"
                    onClick={() => setPendingDelete(row)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          })}

          {rows.orphaned.length > 0 && (
            <div id="orphaned-worktrees">
              <div className={cn('px-5 pt-3 pb-1 text-[10.5px] font-bold uppercase tracking-wider', tintText('red'))}>
                Orphaned worktrees
              </div>
              {rows.orphaned.map((row) => {
                const behind = row.diff?.commitsBehind ?? 0;
                return (
                  <div key={row.worktree.path} className="flex items-center gap-2 border-b border-[var(--theme-border-subtle)] px-5 py-2 last:border-0">
                    <span className="font-mono text-[12px] text-[var(--theme-text-secondary)]">{row.worktree.branch}</span>
                    {behind > 0 && <span className={cn('font-mono text-[11px]', tintText('red'))}>↓{behind}</span>}
                    <span className="ml-auto">
                      <Button variant="danger" size="sm" onClick={() => setPendingDelete(row)}>
                        Remove
                      </Button>
                    </span>
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
