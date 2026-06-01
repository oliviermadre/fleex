import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorktreeDetail, TicketStatus } from '@fleex/shared';
import { DataTable, type Column } from '../ui/DataTable';
import { Modal } from '../ui/Modal';
import { useTicketStore } from '../../stores/ticketStore';
import { fetchWorktreeDetails, deleteWorktree } from '../../services/api';
import { cn } from '../../lib/cn';

interface Props {
  org: string;
  name: string;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return `${Math.floor(days / 30)}mo`;
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(diff / 60000);
  return `${minutes}m`;
}

function isOld(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return Date.now() - new Date(dateStr).getTime() > 14 * 86400000;
}

const STATUS_STYLES: Record<TicketStatus, string> = {
  backlog: 'bg-slate-500/15 text-slate-300',
  todo: 'bg-sky-500/15 text-sky-300',
  doing: 'bg-amber-500/15 text-amber-300',
  reviewing: 'bg-purple-500/15 text-purple-300',
  done: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-rose-500/15 text-rose-300',
};

export function WorktreesSection({ org, name }: Props) {
  const [worktrees, setWorktrees] = useState<WorktreeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<WorktreeDetail | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const tickets = useTicketStore((s) => s.tickets);

  const load = useCallback(() => {
    setLoading(true);
    fetchWorktreeDetails(org, name)
      .then(setWorktrees)
      .catch(() => { /* handled by api layer */ })
      .finally(() => setLoading(false));
  }, [org, name]);

  useEffect(() => { load(); }, [load]);

  const openTicket = useCallback((ticketId: string) => {
    const ticket = tickets.find((t) => t.id === ticketId);
    if (ticket) navigate(`/tickets/board/${ticket.boardId}/ticket/${ticket.id}`);
    else navigate('/tickets');
  }, [tickets, navigate]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteWorktree(org, name, pendingDelete.path);
      setPendingDelete(null);
      load();
    } catch {
      // handled by api layer (error toast)
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, org, name, load]);

  const columns: Column<WorktreeDetail>[] = [
    {
      key: 'branch',
      header: 'Branch',
      render: (row) => (
        <span className={cn('font-mono text-xs truncate', isOld(row.lastCommitAt) && 'text-amber-300/80')}>
          {row.branch}
        </span>
      ),
    },
    {
      key: 'ticket',
      header: 'Ticket',
      shrink: true,
      render: (row) =>
        row.linkedTicket ? (
          <button
            className="flex items-center gap-1.5 hover:underline"
            onClick={(e) => { e.stopPropagation(); openTicket(row.linkedTicket!.id); }}
          >
            <span className="text-[var(--theme-text-muted)]">#t-{row.linkedTicket.displayId}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_STYLES[row.linkedTicket.status])}>
              {row.linkedTicket.status}
            </span>
          </button>
        ) : (
          <span className="text-[var(--theme-text-muted)]">—</span>
        ),
    },
    {
      key: 'activity',
      header: 'Last activity',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span
          className={cn('text-[var(--theme-text-muted)]', isOld(row.lastCommitAt) && 'text-amber-400/60')}
          title={row.lastCommitAt ? new Date(row.lastCommitAt).toLocaleString(undefined, { hour12: false }) : undefined}
        >
          {formatRelativeTime(row.lastCommitAt)}
        </span>
      ),
    },
    {
      key: 'aheadBehind',
      header: 'Ahead/Behind',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span className="font-mono text-xs text-[var(--theme-text-muted)]">
          <span className={cn(row.commitsAhead > 0 && 'text-emerald-400')}>↑{row.commitsAhead}</span>
          {' '}
          <span className={cn(row.commitsBehind > 0 && 'text-sky-400')}>↓{row.commitsBehind}</span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
          <button
            className="rounded px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
            onClick={() => setPendingDelete(row)}
          >
            Delete
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--theme-text-muted)]">
        Local worktrees for this repository. Delete stale ones to reclaim disk space.
      </p>
      <DataTable
        columns={columns}
        data={worktrees}
        selectedIndex={null}
        onSelect={() => {}}
        loading={loading}
        emptyMessage="No worktrees"
        maxHeight="max-h-[calc(100vh-16rem)]"
      />

      <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)} maxWidth="max-w-md">
        <h3 className="mb-2 text-sm font-semibold text-[var(--theme-text-primary)]">Delete worktree</h3>
        <p className="mb-2 text-sm text-[var(--theme-text-secondary)]">
          Remove the worktree for branch{' '}
          <span className="font-mono text-xs text-[var(--theme-text-primary)]">{pendingDelete?.branch}</span>?
        </p>
        <p className="mb-3 break-all font-mono text-[11px] text-[var(--theme-text-muted)]">{pendingDelete?.path}</p>
        {pendingDelete && pendingDelete.commitsAhead > 0 && (
          <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            ⚠ {pendingDelete.commitsAhead} unpushed commit{pendingDelete.commitsAhead > 1 ? 's' : ''} will be lost.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)]"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            className="rounded bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-700 disabled:opacity-50"
            onClick={confirmDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
