/**
 * Task header (center, 44px): title, mono #num, and the shell / overflow controls.
 * The `>_ Shell` button toggles shell mode (⌘⇧J — the center takeover) and shows
 * the ticket's session count; the overflow menu links back to the Kanban home.
 */
import { useNavigate } from 'react-router-dom';
import { useTicketStore } from '../../../stores/ticketStore';
import { useWorkStore } from '../../../stores/workStore';
import { cn } from '../../../lib/cn';
import type { WorkTask } from '../types';

export function TaskHeader({ task }: { task: WorkTask }) {
  const navigate = useNavigate();
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const shellMode = useWorkStore((s) => s.shellMode);
  const setShellMode = useWorkStore((s) => s.setShellMode);

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
          onClick={() => setShellMode(!shellMode)}
          title="Shell mode (⌘⇧J)"
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[12px] transition-colors',
            shellMode
              ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
              : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
          )}
        >
          <span className="font-mono">›_</span> Shell
          {task.sessionCount > 0 && (
            <span className="font-mono text-[var(--theme-text-faint)]">{task.sessionCount}</span>
          )}
        </button>
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
