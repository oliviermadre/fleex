/**
 * Task header (center, 44px): title (click to rename), mono #num, and an
 * overflow menu. Mode switching (Chat / Code / Shell) now lives in the
 * always-visible top-bar ModeSwitcher, so it's no longer duplicated here.
 */
import { useNavigate } from 'react-router-dom';
import { TICKET_TITLE_MAX_LENGTH } from '@fleex/shared';
import { useTicketStore } from '../../../stores/ticketStore';
import { toast } from '../../../lib/toast';
import { InlineEditableText } from '../../ui/InlineEditableText';
import type { WorkTask } from '../types';

export function TaskHeader({ task }: { task: WorkTask }) {
  const navigate = useNavigate();
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const updateTicket = useTicketStore((s) => s.updateTicket);

  // The store is patched on success and `ticket:updated` (WS) carries the new
  // title to the queue, kanban, palette and other clients. The workspace folder
  // keeps its name: the server finds it by ticket id.
  async function rename(title: string) {
    try {
      await updateTicket(task.id, { title });
    } catch (err) {
      // An HTTP error was already toasted with the server's message by the API layer.
      if (!(err instanceof Error && err.message.startsWith('API error'))) {
        toast.error('Impossible de renommer le ticket', { detail: err instanceof Error ? err.message : String(err) });
      }
      throw err;
    }
  }

  // The ticket's board — the ticket itself only opens in the Work view.
  function openInKanban() {
    selectBoard(task.boardId);
    navigate(`/tickets/board/${task.boardId ?? 'all'}`);
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-4">
      <InlineEditableText
        value={task.title}
        onCommit={rename}
        maxLength={TICKET_TITLE_MAX_LENGTH}
        ariaLabel="Ticket title"
        className="min-w-0 cursor-text truncate rounded px-1 -mx-1 text-left text-[14px] font-semibold text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]"
        inputClassName="flex-1 rounded border border-[var(--theme-accent)] bg-transparent px-1 -mx-1 text-[14px] font-semibold text-[var(--theme-text-primary)] focus:outline-none"
      />
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
