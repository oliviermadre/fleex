import { useState, useRef, useCallback } from 'react';
import type { Ticket, TicketStatus, BoardWithCounts } from '@asm/shared';
import { TICKET_STATUS_LABELS } from '@asm/shared';
import { KanbanCard } from './KanbanCard';
import { InlineCardCreator } from './InlineCardCreator';
import { useTicketStore } from '../../stores/ticketStore';
import * as api from '../../services/api';
import { cn } from '../../lib/cn';

const COLUMN_BG: Record<string, string> = {
  backlog: 'bg-[rgba(113,113,122,0.04)]',
  todo: 'bg-orange-500/[0.04]',
  doing: 'bg-blue-500/[0.04]',
  reviewing: 'bg-yellow-500/[0.04]',
  done: 'bg-green-500/[0.04]',
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
        'flex min-h-0 min-w-0 flex-1 flex-col rounded-lg',
        COLUMN_BG[status],
        dragOver && 'ring-2 ring-[var(--theme-accent)]/50',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-2">
        <span className="text-xs font-semibold text-[var(--theme-text-secondary)]">
          {TICKET_STATUS_LABELS[status]}
        </span>
        <span className="rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
          {tickets.length}
        </span>
      </div>

      {/* Cards */}
      <div ref={listRef} className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-1 pb-2">
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
        <InlineCardCreator boardId={boardId} status={status} />
      </div>
    </div>
  );
}
