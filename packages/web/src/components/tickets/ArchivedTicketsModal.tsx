import { useState, useEffect, useCallback } from 'react';
import type { Ticket, BoardWithCounts } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { fetchArchivedTickets } from '../../services/api';
import { useTicketStore } from '../../stores/ticketStore';

const PAGE_SIZE = 20;

export function ArchivedTicketsModal({
  boardId,
  boards,
  onClose,
}: {
  boardId: string | null;
  boards: BoardWithCounts[];
  onClose: () => void;
}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const unarchiveTicket = useTicketStore((s) => s.unarchiveTicket);

  const load = useCallback(async (off: number) => {
    setLoading(true);
    try {
      const res = await fetchArchivedTickets(boardId ?? undefined, PAGE_SIZE, off);
      setTickets(res.tickets);
      setTotal(res.total);
      setOffset(off);
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    load(0);
  }, [load]);

  const handleUnarchive = async (id: string) => {
    await unarchiveTicket(id);
    // Reload the current page
    await load(offset);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const boardName = (bid: string) => {
    const b = boards.find((x) => x.id === bid);
    return b ? `${b.emoji} ${b.name}`.trim() : '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-muted)]">
              <rect x="2" y="3" width="20" height="5" rx="1" />
              <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
              <path d="M10 12h4" />
            </svg>
            <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">
              Archived tickets
            </h2>
            {total > 0 && (
              <span className="rounded-full bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[11px] text-[var(--theme-text-muted)]">
                {total}
              </span>
            )}
          </div>
          <button
            className="rounded p-1 text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && tickets.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--theme-text-muted)]">
              Loading...
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--theme-text-muted)]">
              No archived tickets
            </div>
          ) : (
            <div className="space-y-1">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-[var(--theme-bg-hover)] transition-colors"
                >
                  {/* Priority indicator */}
                  {ticket.priority !== 'none' && (
                    <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      ticket.priority === 'high'
                        ? 'bg-red-500/15 text-red-400'
                        : ticket.priority === 'medium'
                          ? 'bg-yellow-500/15 text-yellow-400'
                          : 'bg-blue-500/15 text-blue-400'
                    }`}>
                      {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                    </span>
                  )}

                  {/* Status badge */}
                  <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    ticket.status === 'done'
                      ? 'bg-green-500/15 text-green-400'
                      : 'bg-red-500/15 text-red-400/70'
                  }`}>
                    {TICKET_STATUS_LABELS[ticket.status]}
                  </span>

                  {/* Title */}
                  <span className="flex-1 truncate text-sm text-[var(--theme-text-primary)]">
                    {ticket.title}
                  </span>

                  {/* Board name */}
                  {boardId === null && (
                    <span className="flex-shrink-0 text-[11px] text-[var(--theme-text-faint)]">
                      {boardName(ticket.boardId)}
                    </span>
                  )}

                  {/* Archived date */}
                  {ticket.archivedAt && (
                    <span className="flex-shrink-0 text-[11px] text-[var(--theme-text-faint)]" title={new Date(ticket.archivedAt).toLocaleString(undefined, { hour12: false })}>
                      {formatRelativeDate(ticket.archivedAt)}
                    </span>
                  )}

                  {/* Unarchive button */}
                  <button
                    className="flex-shrink-0 rounded px-2 py-1 text-[11px] font-medium text-[var(--theme-text-muted)] border border-[var(--theme-border)] hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-primary)] transition-colors"
                    onClick={() => handleUnarchive(ticket.id)}
                  >
                    Unarchive
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--theme-border)] px-5 py-3">
            <button
              className="rounded px-3 py-1.5 text-xs text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              disabled={offset === 0}
              onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <span className="text-xs text-[var(--theme-text-faint)]">
              Page {currentPage} of {totalPages}
            </span>
            <button
              className="rounded px-3 py-1.5 text-xs text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => load(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(dateStr).toLocaleDateString();
}
