/**
 * Task header (center, 44px): title, mono #num, and an overflow menu. Mode
 * switching (Chat / Code / Shell) now lives in the always-visible top-bar
 * ModeSwitcher, so it's no longer duplicated here.
 */
import { useNavigate } from 'react-router-dom';
import { useTicketStore } from '../../../stores/ticketStore';
import type { WorkTask } from '../types';

export function TaskHeader({ task }: { task: WorkTask }) {
  const navigate = useNavigate();
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const selectBoard = useTicketStore((s) => s.selectBoard);

  function openInKanban() {
    selectBoard(task.boardId);
    selectTicket(task.id);
    navigate(`/tickets/board/${task.boardId ?? 'all'}/ticket/${task.id}`);
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-4">
      <span className="truncate text-[14px] font-semibold text-[var(--theme-text-primary)]">{task.title}</span>
      <span className="shrink-0 font-mono text-[12px] text-[var(--theme-text-faint)]">#{task.number}</span>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={openInKanban}
          className="rounded-md px-2 py-1 text-[12px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
          title="Open in Kanban"
        >
          ⋯
        </button>
      </div>
    </div>
  );
}
