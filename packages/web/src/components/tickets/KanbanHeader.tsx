import type { BoardWithCounts } from '@asm/shared';
import { useTicketStore } from '../../stores/ticketStore';

interface KanbanHeaderProps {
  board: BoardWithCounts | null;
  isAllBoards: boolean;
}

export function KanbanHeader({ board, isAllBoards }: KanbanHeaderProps) {
  const tickets = useTicketStore((s) => s.tickets);
  const filters = useTicketStore((s) => s.filters);

  const totalTickets = isAllBoards
    ? tickets.length
    : board
      ? Object.values(board.ticketCounts).reduce((sum: number, c: number) => sum + c, 0)
      : 0;

  const activeFilterCount =
    (filters.repo ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.hasSession !== null ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    (filters.favorite !== null ? 1 : 0);

  return (
    <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
      {isAllBoards ? (
        <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)]">All boards</span>
      ) : board ? (
        <div className="flex items-center gap-2">
          <span className="text-base">{board.emoji}</span>
          <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)]">{board.name}</span>
        </div>
      ) : null}

      <span className="rounded-full bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
        {totalTickets}
      </span>

      {activeFilterCount > 0 && (
        <span className="rounded-full bg-[var(--theme-accent)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--theme-accent)]">
          {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
