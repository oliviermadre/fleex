import type { Board, Ticket, Session } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../../lib/cn';
import { TicketWorkspaceItem } from './TicketWorkspaceItem';

interface Props {
  board: Board;
  tickets: Ticket[];
  sessions: Session[];
}

export function BoardTicketGroup({ board, tickets, sessions }: Props) {
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);

  const groupId = `workspace-board:${board.id}`;
  const collapsed = collapsedGroups.has(groupId);

  return (
    <div className="my-1.5">
      <button
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-[var(--theme-bg-hover)]"
        onClick={() => toggleGroup(groupId)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={cn(
            'text-[var(--theme-text-muted)] transition-transform',
            collapsed ? 'rotate-0' : 'rotate-90',
          )}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>
        <span className="text-sm mr-1">{board.emoji || '📋'}</span>
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
          {board.name}
        </span>
        <span className="ml-auto text-xs text-[var(--theme-text-faint)]">{tickets.length}</span>
      </button>
      {!collapsed &&
        tickets.map((ticket) => (
          <TicketWorkspaceItem key={ticket.id} ticket={ticket} sessions={sessions} />
        ))}
    </div>
  );
}
