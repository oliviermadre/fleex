import { useState, useRef, useCallback } from 'react';
import type { Ticket, TicketStatus, BoardWithCounts } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { KanbanCard } from './KanbanCard';
import { InlineCardCreator } from './InlineCardCreator';
import { useTicketStore } from '../../stores/ticketStore';
import * as api from '../../services/api';
import { cn } from '../../lib/cn';

const COLUMN_TITLE_COLOR: Record<string, string> = {
  backlog: 'text-[var(--theme-text-muted)]',
  todo: 'text-orange-400',
  doing: 'text-blue-400',
  reviewing: 'text-purple-400',
  done: 'text-green-400',
};

const COLUMN_BADGE_COLOR: Record<string, string> = {
  backlog: 'text-[var(--theme-text-muted)] bg-[var(--theme-bg-overlay)]',
  todo: 'text-orange-400 bg-orange-400/10',
  doing: 'text-blue-400 bg-blue-400/10',
  reviewing: 'text-purple-400 bg-purple-400/10',
  done: 'text-green-400 bg-green-400/10',
};

export function KanbanColumn({
  status,
  tickets,
  boardId,
  isAllBoards,
  boards,
  onOpenSession,
}: {
  status: TicketStatus;
  tickets: Ticket[];
  boardId: string;
  isAllBoards?: boolean;
  boards?: BoardWithCounts[];
  onOpenSession: (ticketId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  // Index where the drop indicator should appear (-1 = none, 0..tickets.length)
  const [dropIndex, setDropIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-ticket-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);

    // Determine insertion index based on mouse Y relative to card positions
    const container = listRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-card-index]'));
    const mouseY = e.clientY;

    let idx = tickets.length; // default: append at end
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (mouseY < midY) {
        idx = parseInt(card.dataset.cardIndex!, 10);
        break;
      }
    }
    setDropIndex(idx);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    setDragOver(false);
    setDropIndex(-1);
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const insertAt = dropIndex;
    setDropIndex(-1);

    const ticketId = e.dataTransfer.getData('application/x-ticket-id');
    if (!ticketId) return;

    // Build the new ordered list for this column
    const filtered = tickets.filter((t) => t.id !== ticketId);
    const idx = Math.min(Math.max(insertAt, 0), filtered.length);
    const dragged = useTicketStore.getState().tickets.find((t) => t.id === ticketId);
    if (!dragged) return;

    const movingAcrossColumns = dragged.status !== status;

    // Insert at the target index
    const ordered = [...filtered];
    ordered.splice(idx, 0, dragged as Ticket);

    // Build position updates
    const updates = ordered.map((t, i) => ({
      id: t.id,
      status,
      position: i,
    }));

    // Optimistic update in store
    useTicketStore.setState((s) => {
      const updatedMap = new Map(updates.map((u) => [u.id, u]));
      return {
        tickets: s.tickets.map((t) => {
          const upd = updatedMap.get(t.id);
          if (upd) return { ...t, status: upd.status, position: upd.position };
          return t;
        }),
      };
    });

    // Persist
    if (movingAcrossColumns) {
      // Use moveTicket for the dragged card (creates 'moved' activity), then reorder the rest
      const moveStore = useTicketStore.getState().moveTicket;
      await moveStore(ticketId, status, idx);
      const rest = updates.filter((u) => u.id !== ticketId);
      if (rest.length > 0) await api.reorderTickets(rest);
    } else {
      await api.reorderTickets(updates);
    }
  }, [tickets, status, dropIndex]);

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--theme-border)]',
        dragOver && 'ring-2 ring-inset ring-[var(--theme-accent)]/50',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-4 py-3">
        <span className={cn('text-sm font-bold uppercase tracking-wider', COLUMN_TITLE_COLOR[status])}>
          {TICKET_STATUS_LABELS[status]}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', COLUMN_BADGE_COLOR[status])}>
          {tickets.length}
        </span>
      </div>

      {/* Inline card creator at top */}
      <div className="px-3 py-1.5">
        <InlineCardCreator boardId={boardId} status={status} />
      </div>

      {/* Cards */}
      <div ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-2">
        {tickets.map((ticket, i) => (
          <div key={ticket.id} data-card-index={i}>
            {/* Drop indicator before this card */}
            {dragOver && dropIndex === i && (
              <div className="mx-1 mb-1 h-0.5 rounded-full bg-[var(--theme-accent)]" />
            )}
            <KanbanCard
              ticket={ticket}
              board={isAllBoards ? boards?.find((b) => b.id === ticket.boardId) : undefined}
              onOpenSession={onOpenSession}
            />
          </div>
        ))}
        {/* Drop indicator at the end */}
        {dragOver && dropIndex === tickets.length && (
          <div className="mx-1 mt-0.5 h-0.5 rounded-full bg-[var(--theme-accent)]" />
        )}
      </div>
    </div>
  );
}
